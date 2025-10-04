const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('./auth');
const { NotificationService } = require('./notifications');
const router = express.Router();

// Get all orders
router.get('/', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const { status, customer, date_from, date_to } = req.query;

        let query = `
            SELECT o.*, u.name as created_by_name,
                   (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as items_count
            FROM orders o
            LEFT JOIN users u ON o.created_by = u.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ` AND o.status = $${params.length + 1}`;
            params.push(status);
        }

        if (customer) {
            query += ` AND o.customer_name ILIKE $${params.length + 1}`;
            params.push(`%${customer}%`);
        }

        if (date_from) {
            query += ` AND DATE(o.created_at) >= $${params.length + 1}`;
            params.push(date_from);
        }

        if (date_to) {
            query += ` AND DATE(o.created_at) <= $${params.length + 1}`;
            params.push(date_to);
        }

        query += ' ORDER BY o.created_at DESC';

        const ordersResult = await req.pool.query(query, params);
        const orders = ordersResult.rows;

        res.json(orders);

    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get order by ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const orderId = req.params.id;

        const orderResult = await req.pool.query(`
            SELECT o.*, u.name as created_by_name
            FROM orders o
            LEFT JOIN users u ON o.created_by = u.id
            WHERE o.id = $1
        `, [orderId]);
        const order = orderResult.rows[0];

        if (!order) {
            return res.status(404).json({ message: 'الطلب غير موجود' });
        }

        // Get order items
        const itemsResult = await req.pool.query(`
            SELECT oi.*, m.name as material_name, m.type as material_type
            FROM order_items oi
            LEFT JOIN materials m ON oi.material_id = m.id
            WHERE oi.order_id = $1
        `, [orderId]);
        const items = itemsResult.rows;

        order.items = items;
        res.json(order);

    } catch (error) {
        console.error('Get order error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Create new order
router.post('/', authenticateToken, [
    body('customer_name').notEmpty().withMessage('اسم الزبون مطلوب'),
    body('delivery_method').isIn(['direct', 'sort_then_delivery', 'cut_then_delivery', 'sort_cut_delivery'])
        .withMessage('طريقة التسليم غير صالحة'),
    body('items').isArray({ min: 1 }).withMessage('يجب إضافة عنصر واحد على الأقل')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const {
            customer_name, customer_phone, customer_address, plate_count,
            notes, delivery_method, items
        } = req.body;
        
        const db = req.pool;
        const userId = req.user.id;

        // Generate order number
        const orderNumber = `ORD-${Date.now()}`;

        // Start transaction
        await req.pool.query('BEGIN');

        try {
            // Calculate total amount
            let totalAmount = 0;
            let cuttingFee = 0;

            for (const item of items) {
                // Check material availability
                const materialResult = await req.pool.query('SELECT * FROM materials WHERE id = $1 AND status = $2',
                    [item.material_id, 'available']);
                const material = materialResult.rows[0];

                if (!material) {
                    throw new Error(`المادة ${item.material_id} غير متوفرة`);
                }

                if (material.quantity < item.quantity) {
                    throw new Error(`الكمية غير كافية للمادة ${material.name}`);
                }

                // Reserve material (update quantity)
                await req.pool.query('UPDATE materials SET quantity = quantity - $1, status = $2 WHERE id = $3',
                    [item.quantity, 'reserved', item.material_id]);

                // Calculate prices
                const unitPrice = material.cost / material.quantity; // Simple pricing logic
                const itemTotal = unitPrice * item.quantity;
                totalAmount += itemTotal;

                // Add cutting fee if needed
                if (delivery_method.includes('cut')) {
                    cuttingFee += 10 * item.quantity; // 10 dinars per item for cutting
                }
            }

            totalAmount += cuttingFee;

            // Insert order
            const orderResult = await req.pool.query(`
                INSERT INTO orders (order_number, customer_name, customer_phone, customer_address,
                                  plate_count, notes, delivery_method, total_amount, cutting_fee, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING id
            `, [
                orderNumber, customer_name, customer_phone, customer_address,
                plate_count, notes, delivery_method, totalAmount, cuttingFee, userId
            ]);

            // Insert order items
            for (const item of items) {
                const materialResult = await req.pool.query('SELECT * FROM materials WHERE id = $1', [item.material_id]);
                const material = materialResult.rows[0];

                const unitPrice = material.cost / material.quantity;
                const totalPrice = unitPrice * item.quantity;

                await req.pool.query(`
                    INSERT INTO order_items (order_id, material_id, quantity, weight,
                                           unit_price, total_price, notes)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    orderResult.rows[0].id, item.material_id, item.quantity,
                    material.weight * item.quantity, unitPrice, totalPrice, item.notes
                ]);
            }

            // Commit transaction
            await req.pool.query('COMMIT');

            const newOrderResult = await req.pool.query('SELECT * FROM orders WHERE id = $1', [orderResult.rows[0].id]);
            const newOrder = newOrderResult.rows[0];

            // Create notification for new order
            await NotificationService.createNewOrderNotification(req.pool, newOrder, userId);

            res.status(201).json({
                message: 'تم إنشاء الطلب بنجاح',
                order: newOrder
            });

        } catch (error) {
            // Rollback transaction
            await req.pool.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ message: error.message || 'خطأ في الخادم' });
    }
});

// Update order status
router.patch('/:id/status', authenticateToken, [
    body('status').isIn(['pending', 'processing', 'sorting', 'cutting', 'completed', 'cancelled'])
        .withMessage('حالة الطلب غير صالحة'),
    body('notes').optional()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const orderId = req.params.id;
        const { status, notes } = req.body;

        const result = await req.pool.query('UPDATE orders SET status = $1, notes = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
            [status, notes, orderId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'الطلب غير موجود' });
        }

        // If order is completed, update material status
        if (status === 'completed') {
            const orderItemsResult = await req.pool.query('SELECT material_id, quantity FROM order_items WHERE order_id = $1',
                [orderId]);
            const orderItems = orderItemsResult.rows;

            for (const item of orderItems) {
                await req.pool.query('UPDATE materials SET status = $1 WHERE id = $2',
                    ['available', item.material_id]);
            }
        }

        res.json({ message: 'تم تحديث حالة الطلب بنجاح' });

    } catch (error) {
        console.error('Update order status error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Delete order
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const orderId = req.params.id;
        const db = req.pool;

        // Start transaction
        await req.pool.query('BEGIN');

        try {
            // Get order items to restore material quantities
            const orderItemsResult = await req.pool.query('SELECT material_id, quantity FROM order_items WHERE order_id = $1',
                [orderId]);
            const orderItems = orderItemsResult.rows;

            // Restore material quantities
            for (const item of orderItems) {
                await req.pool.query('UPDATE materials SET quantity = quantity + $1, status = $2 WHERE id = $3',
                    [item.quantity, 'available', item.material_id]);
            }

            // Delete order items
            await req.pool.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);

            // Delete order
            const result = await req.pool.query('DELETE FROM orders WHERE id = $1', [orderId]);

            if (result.rowCount === 0) {
                throw new Error('الطلب غير موجود');
            }

            // Commit transaction
            await req.pool.query('COMMIT');

            res.json({ message: 'تم حذف الطلب بنجاح' });

        } catch (error) {
            // Rollback transaction
            await req.pool.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Delete order error:', error);
        res.status(500).json({ message: error.message || 'خطأ في الخادم' });
    }
});

// Get order statistics
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
                COUNT(*) as total_orders,
                SUM(total_amount) as total_revenue,
                AVG(total_amount) as avg_order_value,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
                COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_orders,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders
            FROM orders
            ${dateFilter}
        `, params);
        const stats = statsResult.rows[0];

        // Get orders by status
        const byStatusResult = await req.pool.query(`
            SELECT status, COUNT(*) as count, SUM(total_amount) as total_amount
            FROM orders
            ${dateFilter}
            GROUP BY status
        `, params);
        const byStatus = byStatusResult.rows;

        res.json({
            summary: stats,
            byStatus
        });

    } catch (error) {
        console.error('Get order stats error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;