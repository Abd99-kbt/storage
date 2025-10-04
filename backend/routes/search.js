const express = require('express');
const { authenticateToken } = require('./auth');
const router = express.Router();

// Advanced search endpoint
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { q, type } = req.query;

        if (!q) {
            return res.status(400).json({ message: 'نص البحث مطلوب' });
        }

        const searchResults = {
            materials: [],
            orders: [],
            invoices: [],
            warehouses: [],
            users: []
        };

        // Search in materials
        if (!type || type === 'materials') {
            const materialsResult = await req.pool.query(`
                SELECT m.*, w.name as warehouse_name
                FROM materials m
                LEFT JOIN warehouses w ON m.warehouse_id = w.id
                WHERE m.name ILIKE $1 OR m.type ILIKE $1 OR m.invoice_number ILIKE $1
                ORDER BY m.created_at DESC
                LIMIT 10
            `, [`%${q}%`]);
            searchResults.materials = materialsResult.rows;
        }

        // Search in orders
        if (!type || type === 'orders') {
            const ordersResult = await req.pool.query(`
                SELECT o.*, u.name as created_by_name
                FROM orders o
                LEFT JOIN users u ON o.created_by = u.id
                WHERE o.order_number ILIKE $1 OR o.customer_name ILIKE $1
                ORDER BY o.created_at DESC
                LIMIT 10
            `, [`%${q}%`]);
            searchResults.orders = ordersResult.rows;
        }

        // Search in invoices
        if (!type || type === 'invoices') {
            const invoicesResult = await req.pool.query(`
                SELECT i.*, o.order_number
                FROM invoices i
                LEFT JOIN orders o ON i.order_id = o.id
                WHERE i.invoice_number ILIKE $1 OR i.customer_name ILIKE $1
                ORDER BY i.created_at DESC
                LIMIT 10
            `, [`%${q}%`]);
            searchResults.invoices = invoicesResult.rows;
        }

        // Search in warehouses
        if (!type || type === 'warehouses') {
            const warehousesResult = await req.pool.query(`
                SELECT w.*, u.name as manager_name
                FROM warehouses w
                LEFT JOIN users u ON w.manager_id = u.id
                WHERE w.name ILIKE $1 OR w.type ILIKE $1 OR w.location ILIKE $1
                ORDER BY w.name
                LIMIT 10
            `, [`%${q}%`]);
            searchResults.warehouses = warehousesResult.rows;
        }

        // Search in users
        if (!type || type === 'users') {
            const usersResult = await req.pool.query(`
                SELECT id, username, name, email, phone, user_type, is_active
                FROM users
                WHERE name ILIKE $1 OR username ILIKE $1 OR email ILIKE $1
                ORDER BY created_at DESC
                LIMIT 10
            `, [`%${q}%`]);
            searchResults.users = usersResult.rows;
        }

        res.json(searchResults);

    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;