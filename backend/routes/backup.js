const express = require('express');
const { authenticateToken } = require('./auth');
const router = express.Router();

// Backup database (admin only)
router.post('/', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه إجراء النسخ الاحتياطي' });
        }

        // This is a simplified backup. In a real system, you'd use pg_dump
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = `backup_${timestamp}.json`;

        // Get all data for backup
        const backupData = {};

        const tables = ['users', 'warehouses', 'materials', 'orders', 'order_items', 'invoices', 'stock_movements'];

        for (const table of tables) {
            const result = await req.pool.query(`SELECT * FROM ${table}`);
            backupData[table] = result.rows;
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${backupFile}"`);
        res.json(backupData);

    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Restore from backup (admin only)
router.post('/restore', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه استعادة النسخ الاحتياطي' });
        }

        const { backupData } = req.body;

        if (!backupData) {
            return res.status(400).json({ message: 'بيانات النسخة الاحتياطية مطلوبة' });
        }

        // Start transaction for restore
        await req.pool.query('BEGIN');

        try {
            // Clear existing data (be careful with this in production!)
            const tables = ['stock_movements', 'order_items', 'invoices', 'orders', 'materials', 'warehouses', 'users'];

            for (const table of tables) {
                if (backupData[table]) {
                    await req.pool.query(`DELETE FROM ${table}`);
                }
            }

            // Restore data in correct order (respecting foreign keys)
            if (backupData.users) {
                for (const user of backupData.users) {
                    await req.pool.query(`
                        INSERT INTO users (username, password, name, email, phone, user_type, is_active, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    `, [user.username, user.password, user.name, user.email, user.phone,
                        user.user_type, user.is_active, user.created_at, user.updated_at]);
                }
            }

            if (backupData.warehouses) {
                for (const warehouse of backupData.warehouses) {
                    await req.pool.query(`
                        INSERT INTO warehouses (name, type, capacity, location, manager_id, is_active, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    `, [warehouse.name, warehouse.type, warehouse.capacity, warehouse.location,
                        warehouse.manager_id, warehouse.is_active, warehouse.created_at, warehouse.updated_at]);
                }
            }

            if (backupData.materials) {
                for (const material of backupData.materials) {
                    await req.pool.query(`
                        INSERT INTO materials (name, weight, quantity, length, width, type, grammage,
                                             invoice_number, quality, roll_number, warehouse_id, source, cost, status, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                    `, [material.name, material.weight, material.quantity, material.length, material.width,
                        material.type, material.grammage, material.invoice_number, material.quality,
                        material.roll_number, material.warehouse_id, material.source, material.cost,
                        material.status, material.created_at, material.updated_at]);
                }
            }

            if (backupData.orders) {
                for (const order of backupData.orders) {
                    await req.pool.query(`
                        INSERT INTO orders (order_number, customer_name, customer_phone, customer_address,
                                          plate_count, notes, delivery_method, status, total_amount, cutting_fee, created_by, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    `, [order.order_number, order.customer_name, order.customer_phone, order.customer_address,
                        order.plate_count, order.notes, order.delivery_method, order.status,
                        order.total_amount, order.cutting_fee, order.created_by, order.created_at, order.updated_at]);
                }
            }

            if (backupData.order_items) {
                for (const item of backupData.order_items) {
                    await req.pool.query(`
                        INSERT INTO order_items (order_id, material_id, quantity, weight, unit_price, total_price, notes)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                    `, [item.order_id, item.material_id, item.quantity, item.weight,
                        item.unit_price, item.total_price, item.notes]);
                }
            }

            if (backupData.invoices) {
                for (const invoice of backupData.invoices) {
                    await req.pool.query(`
                        INSERT INTO invoices (invoice_number, order_id, customer_name, customer_phone, customer_address,
                                            subtotal, cutting_fee, discount, tax, total_amount, status, notes, created_by, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                    `, [invoice.invoice_number, invoice.order_id, invoice.customer_name, invoice.customer_phone,
                        invoice.customer_address, invoice.subtotal, invoice.cutting_fee, invoice.discount,
                        invoice.tax, invoice.total_amount, invoice.status, invoice.notes,
                        invoice.created_by, invoice.created_at, invoice.updated_at]);
                }
            }

            if (backupData.stock_movements) {
                for (const movement of backupData.stock_movements) {
                    await req.pool.query(`
                        INSERT INTO stock_movements (material_id, warehouse_id, movement_type, quantity, weight,
                                                   reference_id, reference_type, notes, created_by, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    `, [movement.material_id, movement.warehouse_id, movement.movement_type,
                        movement.quantity, movement.weight, movement.reference_id,
                        movement.reference_type, movement.notes, movement.created_by, movement.created_at]);
                }
            }

            // Commit transaction
            await req.pool.query('COMMIT');

            res.json({ message: 'تم استعادة النسخة الاحتياطية بنجاح' });

        } catch (error) {
            // Rollback transaction
            await req.pool.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Restore backup error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get backup history (admin only)
router.get('/history', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه الوصول لتاريخ النسخ الاحتياطي' });
        }

        // This is a simplified version. In a real system, you'd track backup history
        const backupHistory = [
            {
                id: 1,
                filename: 'backup_2025-09-29.json',
                created_at: new Date().toISOString(),
                size: '2.5 MB',
                status: 'completed'
            },
            {
                id: 2,
                filename: 'backup_2025-09-28.json',
                created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                size: '2.3 MB',
                status: 'completed'
            }
        ];

        res.json(backupHistory);

    } catch (error) {
        console.error('Get backup history error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;