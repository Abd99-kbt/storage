const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('./auth');
const { NotificationService } = require('./notifications');
const router = express.Router();

// Get all invoices
router.get('/', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const { status, customer, date_from, date_to } = req.query;

        let query = `
            SELECT i.*, o.order_number, u.name as created_by_name,
                   COALESCE(json_agg(
                       json_build_object(
                           'id', ii.id,
                           'material_name', ii.material_name,
                           'description', ii.description,
                           'quantity', ii.quantity,
                           'unit_price', ii.unit_price,
                           'total_price', ii.total_price,
                           'material_id', ii.material_id,
                           'notes', ii.notes
                       )
                   ) FILTER (WHERE ii.id IS NOT NULL), '[]') as items
            FROM invoices i
            LEFT JOIN orders o ON i.order_id = o.id
            LEFT JOIN users u ON i.created_by = u.id
            LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
            WHERE 1=1
        `;

        query += ' GROUP BY i.id, o.order_number, u.name';
        const params = [];

        if (status) {
            query += ` AND i.status = $${params.length + 1}`;
            params.push(status);
        }

        if (customer) {
            query += ` AND i.customer_name ILIKE $${params.length + 1}`;
            params.push(`%${customer}%`);
        }

        if (date_from) {
            query += ` AND DATE(i.created_at) >= $${params.length + 1}`;
            params.push(date_from);
        }

        if (date_to) {
            query += ` AND DATE(i.created_at) <= $${params.length + 1}`;
            params.push(date_to);
        }

        query += ' ORDER BY i.created_at DESC';

        const invoicesResult = await req.pool.query(query, params);
        const invoices = invoicesResult.rows;

        res.json(invoices);

    } catch (error) {
        console.error('Get invoices error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get invoice by ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const invoiceId = req.params.id;

        const invoiceResult = await req.pool.query(`
            SELECT i.*, o.order_number, u.name as created_by_name,
                   json_agg(
                       json_build_object(
                           'id', ii.id,
                           'material_name', ii.material_name,
                           'description', ii.description,
                           'quantity', ii.quantity,
                           'unit_price', ii.unit_price,
                           'total_price', ii.total_price,
                           'material_id', ii.material_id,
                           'notes', ii.notes
                       )
                   ) as items
            FROM invoices i
            LEFT JOIN orders o ON i.order_id = o.id
            LEFT JOIN users u ON i.created_by = u.id
            LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
            WHERE i.id = $1
            GROUP BY i.id, o.order_number, u.name
        `, [invoiceId]);
        const invoice = invoiceResult.rows[0];

        if (!invoice) {
            return res.status(404).json({ message: 'الفاتورة غير موجودة' });
        }

        res.json(invoice);

    } catch (error) {
        console.error('Get invoice error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Create new invoice
router.post('/', authenticateToken, [
    body('order_id').isNumeric().withMessage('رقم الطلب مطلوب'),
    body('customer_name').notEmpty().withMessage('اسم الزبون مطلوب'),
    body('items').isArray({ min: 1 }).withMessage('يجب إضافة عنصر واحد على الأقل'),
    body('items.*.material_name').notEmpty().withMessage('اسم المادة مطلوب'),
    body('items.*.quantity').isNumeric().withMessage('الكمية مطلوبة'),
    body('items.*.unit_price').isNumeric().withMessage('سعر الوحدة مطلوب')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const {
            order_id, customer_name, customer_phone, customer_address,
            items, cutting_fee, discount, notes
        } = req.body;

        const userId = req.user.id;

        // Generate invoice number
        const invoiceNumber = `INV-${Date.now()}`;

        // Check if order exists and is completed
        const orderResult = await req.pool.query('SELECT * FROM orders WHERE id = $1 AND status = $2',
            [order_id, 'completed']);
        const order = orderResult.rows[0];

        if (!order) {
            return res.status(400).json({ message: 'الطلب غير موجود أو لم يكتمل بعد' });
        }

        // Check if invoice already exists for this order
        const existingInvoiceResult = await req.pool.query('SELECT id FROM invoices WHERE order_id = $1', [order_id]);
        const existingInvoice = existingInvoiceResult.rows[0];

        if (existingInvoice) {
            return res.status(400).json({ message: 'يوجد فاتورة مسبقاً لهذا الطلب' });
        }

        // Calculate totals from items
        let subtotal = 0;
        for (const item of items) {
            subtotal += item.quantity * item.unit_price;
        }

        const cuttingFee = parseFloat(cutting_fee) || 0;
        const discountAmount = parseFloat(discount) || 0;
        const tax = (subtotal - discountAmount + cuttingFee) * 0.15; // 15% tax
        const totalAmount = subtotal - discountAmount + cuttingFee + tax;

        // Start transaction
        const client = await req.pool.connect();

        try {
            await client.query('BEGIN');

            // Insert invoice
            const invoiceResult = await client.query(`
                INSERT INTO invoices (invoice_number, order_id, customer_name, customer_phone,
                                    customer_address, subtotal, cutting_fee, discount, tax,
                                    total_amount, notes, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING id
            `, [
                invoiceNumber, order_id, customer_name, customer_phone, customer_address,
                subtotal, cuttingFee, discountAmount, tax, totalAmount, notes, userId
            ]);

            const invoiceId = invoiceResult.rows[0].id;

            // Insert invoice items
            for (const item of items) {
                await client.query(`
                    INSERT INTO invoice_items (invoice_id, material_name, description, quantity,
                                             unit_price, total_price, material_id, notes)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    invoiceId, item.material_name, item.description || '',
                    item.quantity, item.unit_price, item.quantity * item.unit_price,
                    item.material_id || null, item.notes || ''
                ]);
            }

            await client.query('COMMIT');

            // Get the complete invoice with items
            const newInvoiceResult = await req.pool.query(`
                SELECT i.*, o.order_number, u.name as created_by_name,
                       json_agg(
                           json_build_object(
                               'id', ii.id,
                               'material_name', ii.material_name,
                               'description', ii.description,
                               'quantity', ii.quantity,
                               'unit_price', ii.unit_price,
                               'total_price', ii.total_price,
                               'material_id', ii.material_id,
                               'notes', ii.notes
                           )
                       ) as items
                FROM invoices i
                LEFT JOIN orders o ON i.order_id = o.id
                LEFT JOIN users u ON i.created_by = u.id
                LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
                WHERE i.id = $1
                GROUP BY i.id, o.order_number, u.name
            `, [invoiceId]);

            const newInvoice = newInvoiceResult.rows[0];

            // Create notification for invoice creation
            await NotificationService.createInvoiceNotification(req.pool, newInvoice, userId);

            res.status(201).json({
                message: 'تم إنشاء الفاتورة بنجاح',
                invoice: newInvoice
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Create invoice error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update invoice status
router.patch('/:id/status', authenticateToken, [
    body('status').isIn(['draft', 'approved', 'paid', 'delivered', 'cancelled'])
        .withMessage('حالة الفاتورة غير صالحة')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const invoiceId = req.params.id;
        const { status } = req.body;
        const db = req.pool;

        const result = await req.pool.query('UPDATE invoices SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [status, invoiceId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'الفاتورة غير موجودة' });
        }

        res.json({ message: 'تم تحديث حالة الفاتورة بنجاح' });

    } catch (error) {
        console.error('Update invoice status error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Delete invoice
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const invoiceId = req.params.id;
        const db = req.pool;

        const result = await req.pool.query('DELETE FROM invoices WHERE id = $1', [invoiceId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'الفاتورة غير موجودة' });
        }

        res.json({ message: 'تم حذف الفاتورة بنجاح' });

    } catch (error) {
        console.error('Delete invoice error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Approve invoice
router.put('/:id/approve', authenticateToken, async (req, res) => {
    try {
        const invoiceId = req.params.id;
        const userId = req.user.id;

        const result = await req.pool.query(
            'UPDATE invoices SET status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
            ['approved', userId, invoiceId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'الفاتورة غير موجودة' });
        }

        res.json({ message: 'تم اعتماد الفاتورة بنجاح' });

    } catch (error) {
        console.error('Approve invoice error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Mark invoice as paid
router.put('/:id/pay', authenticateToken, async (req, res) => {
    try {
        const invoiceId = req.params.id;

        const result = await req.pool.query(
            'UPDATE invoices SET status = $1, paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['paid', invoiceId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'الفاتورة غير موجودة' });
        }

        res.json({ message: 'تم تحديد الفاتورة كمدفوعة بنجاح' });

    } catch (error) {
        console.error('Mark invoice as paid error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get invoice statistics
router.get('/stats/summary', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const { period } = req.query;

        let dateFilter = '';
        const params = [];

        if (period === 'today') {
            dateFilter = "WHERE DATE(created_at) = CURRENT_DATE";
        } else if (period === 'week') {
            dateFilter = "WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'";
        } else if (period === 'month') {
            dateFilter = "WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'";
        }

        const statsResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_invoices,
                SUM(total_amount) as total_revenue,
                AVG(total_amount) as avg_invoice_value,
                COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_invoices,
                COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_invoices,
                SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END) as paid_amount
            FROM invoices
            ${dateFilter}
        `, params);
        const stats = statsResult.rows[0];

        // Get invoices by status
        const byStatusResult = await req.pool.query(`
            SELECT status, COUNT(*) as count, SUM(total_amount) as total_amount
            FROM invoices
            ${dateFilter}
            GROUP BY status
        `, params);
        const byStatus = byStatusResult.rows;

        res.json({
            summary: stats,
            byStatus
        });

    } catch (error) {
        console.error('Get invoice stats error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Insert sample invoices data for testing
router.post('/seed', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه إضافة البيانات التجريبية' });
        }

        // Check if invoices already exist
        const existingInvoices = await req.pool.query('SELECT COUNT(*) as count FROM invoices');
        if (parseInt(existingInvoices.rows[0].count) > 0) {
            return res.status(400).json({ message: 'البيانات التجريبية موجودة مسبقاً' });
        }

        // Get some orders for reference
        const ordersResult = await req.pool.query('SELECT id FROM orders WHERE status = $1 LIMIT 2', ['completed']);
        const orders = ordersResult.rows;

        if (orders.length === 0) {
            // Create sample orders first if none exist
            const sampleOrders = [
                {
                    order_number: 'ORD-SAMPLE-001',
                    customer_name: 'شركة الأعمال الحديثة',
                    customer_phone: '0791234567',
                    customer_address: 'عمان - الاردن',
                    plate_count: 100,
                    delivery_method: 'direct',
                    total_amount: 1000,
                    cutting_fee: 0,
                    status: 'completed',
                    created_by: req.user.id
                },
                {
                    order_number: 'ORD-SAMPLE-002',
                    customer_name: 'مؤسسة التجارة العالمية',
                    customer_phone: '0797654321',
                    customer_address: 'عمان - الاردن',
                    plate_count: 150,
                    delivery_method: 'cut_then_delivery',
                    total_amount: 1500,
                    cutting_fee: 150,
                    status: 'completed',
                    created_by: req.user.id
                }
            ];

            for (const orderData of sampleOrders) {
                const orderResult = await req.pool.query(`
                    INSERT INTO orders (order_number, customer_name, customer_phone, customer_address,
                                      plate_count, delivery_method, total_amount, cutting_fee, status, created_by)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING id
                `, [
                    orderData.order_number, orderData.customer_name, orderData.customer_phone,
                    orderData.customer_address, orderData.plate_count, orderData.delivery_method,
                    orderData.total_amount, orderData.cutting_fee, orderData.status, orderData.created_by
                ]);

                // Add sample order items for each order
                const sampleMaterials = [
                    { name: 'ورق أبيض A4', quantity: 50, unit_price: 10 },
                    { name: 'ورق كرتون مموج', quantity: 30, unit_price: 15 }
                ];

                for (const material of sampleMaterials) {
                    await req.pool.query(`
                        INSERT INTO order_items (order_id, material_id, quantity, unit_price, total_price, notes)
                        VALUES ($1, $2, $3, $4, $5, $6)
                    `, [
                        orderResult.rows[0].id, 1, material.quantity, material.unit_price,
                        material.quantity * material.unit_price, 'عنصر تجريبي'
                    ]);
                }
            }

            // Now get the created orders
            const newOrdersResult = await req.pool.query('SELECT id FROM orders WHERE status = $1 ORDER BY id DESC LIMIT 2', ['completed']);
            orders.push(...newOrdersResult.rows);
        }

        const sampleInvoices = [
            {
                invoice_number: 'INV-2025-001',
                order_id: orders[0].id,
                customer_name: 'شركة الأعمال الحديثة',
                subtotal: 10000,
                tax: 1500,
                total_amount: 11500,
                status: 'paid',
                created_by: req.user.id
            },
            {
                invoice_number: 'INV-2025-002',
                order_id: orders[1].id,
                customer_name: 'مؤسسة التجارة العالمية',
                subtotal: 15000,
                tax: 2250,
                total_amount: 17250,
                status: 'approved',
                created_by: req.user.id
            }
        ];

        for (const invoice of sampleInvoices) {
            await req.pool.query(`
                INSERT INTO invoices (invoice_number, order_id, customer_name, subtotal, tax, total_amount, status, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                invoice.invoice_number,
                invoice.order_id,
                invoice.customer_name,
                invoice.subtotal,
                invoice.tax,
                invoice.total_amount,
                invoice.status,
                invoice.created_by
            ]);
        }

        res.json({ message: 'تم إضافة البيانات التجريبية بنجاح' });

    } catch (error) {
        console.error('Seed invoices error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update invoice
router.put('/:id', authenticateToken, [
    body('customer_name').notEmpty().withMessage('اسم الزبون مطلوب'),
    body('items').isArray({ min: 1 }).withMessage('يجب إضافة عنصر واحد على الأقل'),
    body('items.*.material_name').notEmpty().withMessage('اسم المادة مطلوب'),
    body('items.*.quantity').isNumeric().withMessage('الكمية مطلوبة'),
    body('items.*.unit_price').isNumeric().withMessage('سعر الوحدة مطلوب')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const invoiceId = req.params.id;
        const {
            customer_name, customer_phone, customer_address,
            items, cutting_fee, discount, notes
        } = req.body;

        // Calculate totals from items
        let subtotal = 0;
        for (const item of items) {
            subtotal += item.quantity * item.unit_price;
        }

        const cuttingFee = parseFloat(cutting_fee) || 0;
        const discountAmount = parseFloat(discount) || 0;
        const tax = (subtotal - discountAmount + cuttingFee) * 0.15; // 15% tax
        const totalAmount = subtotal - discountAmount + cuttingFee + tax;

        const client = await req.pool.connect();

        try {
            await client.query('BEGIN');

            // Update invoice
            await client.query(`
                UPDATE invoices
                SET customer_name = $1, customer_phone = $2, customer_address = $3,
                    subtotal = $4, cutting_fee = $5, discount = $6, tax = $7,
                    total_amount = $8, notes = $9, updated_at = CURRENT_TIMESTAMP
                WHERE id = $10
            `, [
                customer_name, customer_phone, customer_address,
                subtotal, cuttingFee, discountAmount, tax, totalAmount, notes, invoiceId
            ]);

            // Delete existing items
            await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [invoiceId]);

            // Insert new items
            for (const item of items) {
                await client.query(`
                    INSERT INTO invoice_items (invoice_id, material_name, description, quantity,
                                             unit_price, total_price, material_id, notes)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    invoiceId, item.material_name, item.description || '',
                    item.quantity, item.unit_price, item.quantity * item.unit_price,
                    item.material_id || null, item.notes || ''
                ]);
            }

            await client.query('COMMIT');

            // Get updated invoice
            const updatedInvoiceResult = await req.pool.query(`
                SELECT i.*, o.order_number, u.name as created_by_name,
                       json_agg(
                           json_build_object(
                               'id', ii.id,
                               'material_name', ii.material_name,
                               'description', ii.description,
                               'quantity', ii.quantity,
                               'unit_price', ii.unit_price,
                               'total_price', ii.total_price,
                               'material_id', ii.material_id,
                               'notes', ii.notes
                           )
                       ) as items
                FROM invoices i
                LEFT JOIN orders o ON i.order_id = o.id
                LEFT JOIN users u ON i.created_by = u.id
                LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
                WHERE i.id = $1
                GROUP BY i.id, o.order_number, u.name
            `, [invoiceId]);

            const updatedInvoice = updatedInvoiceResult.rows[0];

            res.json({
                message: 'تم تحديث الفاتورة بنجاح',
                invoice: updatedInvoice
            });

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Update invoice error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Add invoice item
router.post('/:id/items', authenticateToken, [
    body('material_name').notEmpty().withMessage('اسم المادة مطلوب'),
    body('quantity').isNumeric().withMessage('الكمية مطلوبة'),
    body('unit_price').isNumeric().withMessage('سعر الوحدة مطلوب')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const invoiceId = req.params.id;
        const { material_name, description, quantity, unit_price, material_id, notes } = req.body;

        const totalPrice = quantity * unit_price;

        const result = await req.pool.query(`
            INSERT INTO invoice_items (invoice_id, material_name, description, quantity,
                                     unit_price, total_price, material_id, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `, [invoiceId, material_name, description || '', quantity, unit_price, totalPrice, material_id || null, notes || '']);

        // Update invoice totals
        await updateInvoiceTotals(req.pool, invoiceId);

        res.status(201).json({
            message: 'تم إضافة العنصر بنجاح',
            item: result.rows[0]
        });

    } catch (error) {
        console.error('Add invoice item error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update invoice item
router.put('/:id/items/:itemId', authenticateToken, [
    body('material_name').notEmpty().withMessage('اسم المادة مطلوب'),
    body('quantity').isNumeric().withMessage('الكمية مطلوبة'),
    body('unit_price').isNumeric().withMessage('سعر الوحدة مطلوب')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { id: invoiceId, itemId } = req.params;
        const { material_name, description, quantity, unit_price, material_id, notes } = req.body;

        const totalPrice = quantity * unit_price;

        const result = await req.pool.query(`
            UPDATE invoice_items
            SET material_name = $1, description = $2, quantity = $3,
                unit_price = $4, total_price = $5, material_id = $6, notes = $7
            WHERE id = $8 AND invoice_id = $9
            RETURNING *
        `, [material_name, description || '', quantity, unit_price, totalPrice, material_id || null, notes || '', itemId, invoiceId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'العنصر غير موجود' });
        }

        // Update invoice totals
        await updateInvoiceTotals(req.pool, invoiceId);

        res.json({
            message: 'تم تحديث العنصر بنجاح',
            item: result.rows[0]
        });

    } catch (error) {
        console.error('Update invoice item error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Delete invoice item
router.delete('/:id/items/:itemId', authenticateToken, async (req, res) => {
    try {
        const { id: invoiceId, itemId } = req.params;

        const result = await req.pool.query(
            'DELETE FROM invoice_items WHERE id = $1 AND invoice_id = $2',
            [itemId, invoiceId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'العنصر غير موجود' });
        }

        // Update invoice totals
        await updateInvoiceTotals(req.pool, invoiceId);

        res.json({ message: 'تم حذف العنصر بنجاح' });

    } catch (error) {
        console.error('Delete invoice item error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Helper function to update invoice totals
async function updateInvoiceTotals(pool, invoiceId) {
    try {
        // Calculate new totals from items
        const itemsResult = await pool.query(
            'SELECT SUM(total_price) as subtotal FROM invoice_items WHERE invoice_id = $1',
            [invoiceId]
        );

        const subtotal = parseFloat(itemsResult.rows[0].subtotal) || 0;

        // Get current invoice data for cutting_fee and discount
        const invoiceResult = await pool.query(
            'SELECT cutting_fee, discount FROM invoices WHERE id = $1',
            [invoiceId]
        );

        const { cutting_fee, discount } = invoiceResult.rows[0];
        const cuttingFee = parseFloat(cutting_fee) || 0;
        const discountAmount = parseFloat(discount) || 0;

        const tax = (subtotal - discountAmount + cuttingFee) * 0.15;
        const totalAmount = subtotal - discountAmount + cuttingFee + tax;

        // Update invoice totals
        await pool.query(`
            UPDATE invoices
            SET subtotal = $1, tax = $2, total_amount = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
        `, [subtotal, tax, totalAmount, invoiceId]);

    } catch (error) {
        console.error('Error updating invoice totals:', error);
        throw error;
    }
}

module.exports = router;