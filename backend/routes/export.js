const express = require('express');
const { authenticateToken } = require('./auth');
const router = express.Router();

// Export data endpoint
router.get('/:type', authenticateToken, async (req, res) => {
    try {
        const { type } = req.params;
        const { format } = req.query;

        let data = [];
        let filename = '';

        switch (type) {
            case 'materials':
                const materialsResult = await req.pool.query(`
                    SELECT m.*, w.name as warehouse_name
                    FROM materials m
                    LEFT JOIN warehouses w ON m.warehouse_id = w.id
                    ORDER BY m.created_at DESC
                `);
                data = materialsResult.rows;
                filename = 'materials';
                break;

            case 'orders':
                const ordersResult = await req.pool.query(`
                    SELECT o.*, u.name as created_by_name
                    FROM orders o
                    LEFT JOIN users u ON o.created_by = u.id
                    ORDER BY o.created_at DESC
                `);
                data = ordersResult.rows;
                filename = 'orders';
                break;

            case 'invoices':
                const invoicesResult = await req.pool.query(`
                    SELECT i.*, o.order_number
                    FROM invoices i
                    LEFT JOIN orders o ON i.order_id = o.id
                    ORDER BY i.created_at DESC
                `);
                data = invoicesResult.rows;
                filename = 'invoices';
                break;

            case 'warehouses':
                const warehousesResult = await req.pool.query(`
                    SELECT w.*, u.name as manager_name
                    FROM warehouses w
                    LEFT JOIN users u ON w.manager_id = u.id
                    ORDER BY w.name
                `);
                data = warehousesResult.rows;
                filename = 'warehouses';
                break;

            case 'users':
                const usersResult = await req.pool.query(`
                    SELECT id, username, name, email, phone, user_type, is_active, created_at
                    FROM users
                    ORDER BY created_at DESC
                `);
                data = usersResult.rows;
                filename = 'users';
                break;

            default:
                return res.status(400).json({ message: 'نوع البيانات غير صالح' });
        }

        // Set headers for file download
        const timestamp = new Date().toISOString().split('T')[0];
        filename = `${filename}_${timestamp}`;

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

            // Convert data to CSV format
            if (data.length > 0) {
                const headers = Object.keys(data[0]);
                const csvHeaders = headers.join(',');
                const csvRows = data.map(row =>
                    headers.map(header => `"${row[header] || ''}"`).join(',')
                );
                const csvContent = [csvHeaders, ...csvRows].join('\n');
                res.send(csvContent);
            } else {
                res.send('No data found');
            }
        } else {
            // Default JSON format
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
            res.json(data);
        }

    } catch (error) {
        console.error('Export data error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;