const express = require('express');
const { authenticateToken } = require('./auth');
const router = express.Router();

// Get dashboard statistics
router.get('/dashboard-stats', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;

        // Get total materials count and weight
        const materialsResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_materials,
                SUM(quantity) as total_quantity,
                SUM(weight * quantity) as total_weight,
                SUM(cost) as total_value
            FROM materials
            WHERE status = 'available'
        `);

        // Get active orders count
        const ordersResult = await req.pool.query(`
            SELECT COUNT(*) as active_orders
            FROM orders
            WHERE status IN ('pending', 'processing', 'sorting', 'cutting')
        `);

        // Get warehouses count
        const warehousesResult = await req.pool.query(`
            SELECT COUNT(*) as total_warehouses
            FROM warehouses
            WHERE is_active = true
        `);

        // Get total revenue from paid invoices
        const revenueResult = await req.pool.query(`
            SELECT SUM(total_amount) as total_revenue
            FROM invoices
            WHERE status = 'paid'
        `);

        const stats = {
            totalMaterials: parseInt(materialsResult.rows[0].total_materials) || 0,
            totalQuantity: parseInt(materialsResult.rows[0].total_quantity) || 0,
            totalWeight: parseFloat(materialsResult.rows[0].total_weight) || 0,
            totalValue: parseFloat(materialsResult.rows[0].total_value) || 0,
            activeOrders: parseInt(ordersResult.rows[0].active_orders) || 0,
            totalWarehouses: parseInt(warehousesResult.rows[0].total_warehouses) || 0,
            totalRevenue: parseFloat(revenueResult.rows[0].total_revenue) || 0
        };

        res.json(stats);

    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get recent activities
router.get('/recent-activities', authenticateToken, async (req, res) => {
    try {
        // Get recent stock movements
        const movementsResult = await req.pool.query(`
            SELECT
                sm.created_at,
                sm.movement_type,
                sm.quantity,
                m.name as material_name,
                w.name as warehouse_name,
                u.name as user_name
            FROM stock_movements sm
            LEFT JOIN materials m ON sm.material_id = m.id
            LEFT JOIN warehouses w ON sm.warehouse_id = w.id
            LEFT JOIN users u ON sm.created_by = u.id
            ORDER BY sm.created_at DESC
            LIMIT 10
        `);

        const activities = movementsResult.rows.map(row => ({
            type: row.movement_type === 'in' ? 'إدخال' : 'إخراج',
            description: `${row.movement_type === 'in' ? 'تم إدخال' : 'تم إخراج'} ${row.quantity} من ${row.material_name}`,
            location: row.warehouse_name,
            user: row.user_name,
            time: row.created_at,
            icon: row.movement_type === 'in' ? 'plus' : 'minus'
        }));

        res.json(activities);

    } catch (error) {
        console.error('Recent activities error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get dashboard statistics
router.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;

        // Materials statistics
        const materialsStats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_materials,
                    SUM(quantity) as total_quantity,
                    SUM(weight * quantity) as total_weight,
                    SUM(cost) as total_value
                FROM materials 
                WHERE status = 'available'
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        // Orders statistics
        const ordersStats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_orders,
                    SUM(total_amount) as total_revenue,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
                    COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_orders,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders
                FROM orders 
                WHERE DATE(created_at) = DATE('now')
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        // Warehouses statistics
        const warehousesStats = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_warehouses,
                    COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_warehouses
                FROM warehouses
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        // Recent activities (last 5)
        const recentActivities = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 'order' as type, order_number as reference, customer_name as description, created_at
                FROM orders 
                ORDER BY created_at DESC 
                LIMIT 3
            `, (err, orderRows) => {
                if (err) {
                    reject(err);
                    return;
                }

                db.all(`
                    SELECT 'material' as type, name as reference, 'إضافة مادة جديدة' as description, created_at
                    FROM materials 
                    ORDER BY created_at DESC 
                    LIMIT 2
                `, (err, materialRows) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const activities = [...orderRows, ...materialRows]
                        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                        .slice(0, 5);

                    resolve(activities);
                });
            });
        });

        // Material movement chart data (last 6 months)
        const chartData = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    strftime('%Y-%m', created_at) as month,
                    COUNT(*) as count,
                    SUM(weight * quantity) as total_weight
                FROM materials 
                WHERE created_at >= DATE('now', '-6 months')
                GROUP BY strftime('%Y-%m', created_at)
                ORDER BY month
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Orders status chart data
        const ordersStatus = await new Promise((resolve, reject) => {
            db.all(`
                SELECT status, COUNT(*) as count
                FROM orders 
                WHERE DATE(created_at) = DATE('now')
                GROUP BY status
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        res.json({
            materials: materialsStats,
            orders: ordersStats,
            warehouses: warehousesStats,
            recentActivities,
            charts: {
                materialMovement: chartData,
                ordersStatus: ordersStatus
            }
        });

    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get materials report
router.get('/materials', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const { warehouse_id, type, quality, date_from, date_to } = req.query;

        let query = `
            SELECT 
                m.*, w.name as warehouse_name,
                SUM(sm.quantity) as total_movements
            FROM materials m
            LEFT JOIN warehouses w ON m.warehouse_id = w.id
            LEFT JOIN stock_movements sm ON m.id = sm.material_id
            WHERE 1=1
        `;
        const params = [];

        if (warehouse_id) {
            query += ' AND m.warehouse_id = ?';
            params.push(warehouse_id);
        }

        if (type) {
            query += ' AND m.type = ?';
            params.push(type);
        }

        if (quality) {
            query += ' AND m.quality = ?';
            params.push(quality);
        }

        if (date_from) {
            query += ' AND DATE(m.created_at) >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND DATE(m.created_at) <= ?';
            params.push(date_to);
        }

        query += ' GROUP BY m.id ORDER BY m.created_at DESC';

        const materials = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Get summary statistics
        const summary = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_count,
                    SUM(quantity) as total_quantity,
                    SUM(weight * quantity) as total_weight,
                    SUM(cost) as total_value,
                    AVG(cost) as avg_cost
                FROM materials 
                WHERE 1=1
            ` + (warehouse_id ? ' AND warehouse_id = ?' : '') + 
            (type ? ' AND type = ?' : '') +
            (quality ? ' AND quality = ?' : ''), 
            params.filter((_, i) => i < (warehouse_id ? 1 : 0) + (type ? 1 : 0) + (quality ? 1 : 0)), 
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        res.json({
            summary,
            materials
        });

    } catch (error) {
        console.error('Get materials report error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get orders report
router.get('/orders', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const { status, customer, date_from, date_to, delivery_method } = req.query;

        let query = `
            SELECT 
                o.*, u.name as created_by_name,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as items_count
            FROM orders o
            LEFT JOIN users u ON o.created_by = u.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND o.status = ?';
            params.push(status);
        }

        if (customer) {
            query += ' AND o.customer_name LIKE ?';
            params.push(`%${customer}%`);
        }

        if (delivery_method) {
            query += ' AND o.delivery_method = ?';
            params.push(delivery_method);
        }

        if (date_from) {
            query += ' AND DATE(o.created_at) >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND DATE(o.created_at) <= ?';
            params.push(date_to);
        }

        query += ' ORDER BY o.created_at DESC';

        const orders = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Get summary statistics
        const summary = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_count,
                    SUM(total_amount) as total_revenue,
                    AVG(total_amount) as avg_order_value,
                    SUM(cutting_fee) as total_cutting_fees,
                    COUNT(DISTINCT customer_name) as unique_customers
                FROM orders 
                WHERE 1=1
            ` + (status ? ' AND status = ?' : '') +
            (delivery_method ? ' AND delivery_method = ?' : '') +
            (date_from ? ' AND DATE(created_at) >= ?' : '') +
            (date_to ? ' AND DATE(created_at) <= ?' : ''), 
            params.filter((_, i) => i < (status ? 1 : 0) + (delivery_method ? 1 : 0) + (date_from ? 1 : 0) + (date_to ? 1 : 0)), 
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        // Get orders by status
        const byStatus = await new Promise((resolve, reject) => {
            db.all(`
                SELECT status, COUNT(*) as count, SUM(total_amount) as total_amount
                FROM orders 
                WHERE 1=1
            ` + (date_from ? ' AND DATE(created_at) >= ?' : '') +
            (date_to ? ' AND DATE(created_at) <= ?' : ''), 
            params.filter((_, i) => i >= (status ? 1 : 0) + (delivery_method ? 1 : 0) && i < (status ? 1 : 0) + (delivery_method ? 1 : 0) + (date_from ? 1 : 0) + (date_to ? 1 : 0)), 
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        res.json({
            summary,
            orders,
            byStatus
        });

    } catch (error) {
        console.error('Get orders report error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get invoices report
router.get('/invoices', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const { status, customer, date_from, date_to } = req.query;

        let query = `
            SELECT 
                i.*, o.order_number, u.name as created_by_name
            FROM invoices i
            LEFT JOIN orders o ON i.order_id = o.id
            LEFT JOIN users u ON i.created_by = u.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND i.status = ?';
            params.push(status);
        }

        if (customer) {
            query += ' AND i.customer_name LIKE ?';
            params.push(`%${customer}%`);
        }

        if (date_from) {
            query += ' AND DATE(i.created_at) >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND DATE(i.created_at) <= ?';
            params.push(date_to);
        }

        query += ' ORDER BY i.created_at DESC';

        const invoices = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Get summary statistics
        const summary = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_count,
                    SUM(total_amount) as total_revenue,
                    SUM(subtotal) as total_subtotal,
                    SUM(cutting_fee) as total_cutting_fees,
                    SUM(discount) as total_discounts,
                    SUM(tax) as total_tax,
                    AVG(total_amount) as avg_invoice_value
                FROM invoices 
                WHERE 1=1
            ` + (status ? ' AND status = ?' : '') +
            (date_from ? ' AND DATE(created_at) >= ?' : '') +
            (date_to ? ' AND DATE(created_at) <= ?' : ''), 
            params.filter((_, i) => i < (status ? 1 : 0) + (date_from ? 1 : 0) + (date_to ? 1 : 0)), 
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        // Get invoices by status
        const byStatus = await new Promise((resolve, reject) => {
            db.all(`
                SELECT status, COUNT(*) as count, SUM(total_amount) as total_amount
                FROM invoices 
                WHERE 1=1
            ` + (date_from ? ' AND DATE(created_at) >= ?' : '') +
            (date_to ? ' AND DATE(created_at) <= ?' : ''), 
            params.filter((_, i) => i >= (status ? 1 : 0) && i < (status ? 1 : 0) + (date_from ? 1 : 0) + (date_to ? 1 : 0)), 
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        res.json({
            summary,
            invoices,
            byStatus
        });

    } catch (error) {
        console.error('Get invoices report error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get warehouses report
router.get('/warehouses', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const { type, status } = req.query;

        let query = `
            SELECT 
                w.*, u.name as manager_name,
                COUNT(m.id) as materials_count,
                SUM(m.quantity) as total_quantity,
                SUM(m.weight * m.quantity) as total_weight,
                SUM(m.cost) as total_value
            FROM warehouses w
            LEFT JOIN users u ON w.manager_id = u.id
            LEFT JOIN materials m ON w.id = m.warehouse_id AND m.status = 'available'
            WHERE 1=1
        `;
        const params = [];

        if (type) {
            query += ' AND w.type = ?';
            params.push(type);
        }

        if (status) {
            query += ' AND w.is_active = ?';
            params.push(status === 'active' ? 1 : 0);
        }

        query += ' GROUP BY w.id ORDER BY w.name';

        const warehouses = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Get summary statistics
        const summary = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_count,
                    SUM(capacity) as total_capacity,
                    COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_count
                FROM warehouses 
                WHERE 1=1
            ` + (type ? ' AND type = ?' : ''), 
            params.filter((_, i) => i < (type ? 1 : 0)), 
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        // Get warehouses by type
        const byType = await new Promise((resolve, reject) => {
            db.all(`
                SELECT type, COUNT(*) as count, SUM(capacity) as total_capacity
                FROM warehouses 
                WHERE 1=1
            ` + (status ? ' AND is_active = ?' : ''), 
            params.filter((_, i) => i >= (type ? 1 : 0)), 
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        res.json({
            summary,
            warehouses,
            byType
        });

    } catch (error) {
        console.error('Get warehouses report error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get waste report
router.get('/waste', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const { date_from, date_to } = req.query;

        // This is a simplified waste report. In a real system, you would track waste explicitly
        let query = `
            SELECT 
                'material_damaged' as waste_type,
                COUNT(*) as count,
                SUM(cost) as total_value,
                'تالف أثناء التخزين' as description
            FROM materials 
            WHERE status = 'damaged'
        `;
        const params = [];

        if (date_from) {
            query += ' AND DATE(created_at) >= ?';
            params.push(date_from);
        }

        if (date_to) {
            query += ' AND DATE(created_at) <= ?';
            params.push(date_to);
        }

        const waste = await new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Calculate waste percentage
        const totalMaterials = await new Promise((resolve, reject) => {
            db.get(`
                SELECT COUNT(*) as count, SUM(cost) as total_value
                FROM materials 
                WHERE 1=1
            ` + (date_from ? ' AND DATE(created_at) >= ?' : '') +
            (date_to ? ' AND DATE(created_at) <= ?' : ''), 
            params.filter((_, i) => i >= (date_from ? 1 : 0) + (date_to ? 1 : 0)), 
            (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        const wastePercentage = totalMaterials.count > 0 ? 
            (waste.reduce((sum, w) => sum + w.count, 0) / totalMaterials.count * 100) : 0;

        const wasteValuePercentage = totalMaterials.total_value > 0 ? 
            (waste.reduce((sum, w) => sum + w.total_value, 0) / totalMaterials.total_value * 100) : 0;

        res.json({
            summary: {
                total_waste_count: waste.reduce((sum, w) => sum + w.count, 0),
                total_waste_value: waste.reduce((sum, w) => sum + w.total_value, 0),
                waste_percentage: wastePercentage,
                waste_value_percentage: wasteValuePercentage
            },
            waste
        });

    } catch (error) {
        console.error('Get waste report error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get materials report
router.get('/materials-report', authenticateToken, async (req, res) => {
    try {
        const { warehouse_id, type, quality, status, date_from, date_to } = req.query;

        let query = `
            SELECT
                m.*,
                w.name as warehouse_name,
                EXTRACT(YEAR FROM m.created_at) as year,
                EXTRACT(MONTH FROM m.created_at) as month
            FROM materials m
            LEFT JOIN warehouses w ON m.warehouse_id = w.id
            WHERE 1=1
        `;
        const params = [];

        if (warehouse_id) {
            query += ` AND m.warehouse_id = $${params.length + 1}`;
            params.push(warehouse_id);
        }

        if (type) {
            query += ` AND m.type = $${params.length + 1}`;
            params.push(type);
        }

        if (quality) {
            query += ` AND m.quality = $${params.length + 1}`;
            params.push(quality);
        }

        if (status) {
            query += ` AND m.status = $${params.length + 1}`;
            params.push(status);
        }

        if (date_from) {
            query += ` AND DATE(m.created_at) >= $${params.length + 1}`;
            params.push(date_from);
        }

        if (date_to) {
            query += ` AND DATE(m.created_at) <= $${params.length + 1}`;
            params.push(date_to);
        }

        query += ' ORDER BY m.created_at DESC';

        const materialsResult = await req.pool.query(query, params);
        const materials = materialsResult.rows;

        // Generate summary statistics
        const summaryResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_materials,
                SUM(quantity) as total_quantity,
                SUM(weight * quantity) as total_weight,
                SUM(cost) as total_value,
                COUNT(DISTINCT type) as material_types,
                COUNT(DISTINCT warehouse_id) as warehouses_count
            FROM materials
            WHERE status = 'available'
        `);
        const summary = summaryResult.rows[0];

        // Get materials by type
        const byTypeResult = await req.pool.query(`
            SELECT type, COUNT(*) as count, SUM(quantity) as total_quantity, SUM(cost) as total_value
            FROM materials
            WHERE status = 'available'
            GROUP BY type
            ORDER BY count DESC
        `);
        const byType = byTypeResult.rows;

        // Get materials by warehouse
        const byWarehouseResult = await req.pool.query(`
            SELECT w.name as warehouse_name, COUNT(*) as count, SUM(m.quantity) as total_quantity
            FROM materials m
            LEFT JOIN warehouses w ON m.warehouse_id = w.id
            WHERE m.status = 'available'
            GROUP BY w.name
            ORDER BY count DESC
        `);
        const byWarehouse = byWarehouseResult.rows;

        res.json({
            materials,
            summary,
            byType,
            byWarehouse
        });

    } catch (error) {
        console.error('Materials report error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get orders report
router.get('/orders-report', authenticateToken, async (req, res) => {
    try {
        const { status, customer, date_from, date_to } = req.query;

        let query = `
            SELECT
                o.*,
                u.name as created_by_name,
                EXTRACT(YEAR FROM o.created_at) as year,
                EXTRACT(MONTH FROM o.created_at) as month
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

        // Generate summary statistics
        const summaryResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_orders,
                SUM(total_amount) as total_revenue,
                AVG(total_amount) as avg_order_value,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
                COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_orders,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders
            FROM orders
        `);
        const summary = summaryResult.rows[0];

        // Get orders by status
        const byStatusResult = await req.pool.query(`
            SELECT status, COUNT(*) as count, SUM(total_amount) as total_amount
            FROM orders
            GROUP BY status
            ORDER BY count DESC
        `);
        const byStatus = byStatusResult.rows;

        // Get orders by month
        const byMonthResult = await req.pool.query(`
            SELECT
                EXTRACT(YEAR FROM created_at) as year,
                EXTRACT(MONTH FROM created_at) as month,
                COUNT(*) as count,
                SUM(total_amount) as total_amount
            FROM orders
            GROUP BY EXTRACT(YEAR FROM created_at), EXTRACT(MONTH FROM created_at)
            ORDER BY year DESC, month DESC
            LIMIT 12
        `);
        const byMonth = byMonthResult.rows;

        res.json({
            orders,
            summary,
            byStatus,
            byMonth
        });

    } catch (error) {
        console.error('Orders report error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get financial report
router.get('/financial-report', authenticateToken, async (req, res) => {
    try {
        const { date_from, date_to } = req.query;

        let dateFilter = '';
        const params = [];

        if (date_from) {
            dateFilter += ` AND DATE(i.created_at) >= $${params.length + 1}`;
            params.push(date_from);
        }

        if (date_to) {
            dateFilter += ` AND DATE(i.created_at) <= $${params.length + 1}`;
            params.push(date_to);
        }

        // Get financial summary
        const summaryResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_invoices,
                SUM(total_amount) as total_revenue,
                SUM(subtotal) as total_subtotal,
                SUM(cutting_fee) as total_cutting_fees,
                SUM(discount) as total_discounts,
                SUM(tax) as total_tax,
                AVG(total_amount) as avg_invoice_value,
                COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_invoices,
                COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_invoices,
                SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END) as paid_amount
            FROM invoices i
            WHERE 1=1 ${dateFilter}
        `, params);
        const summary = summaryResult.rows[0];

        // Get revenue by month
        const revenueByMonthResult = await req.pool.query(`
            SELECT
                EXTRACT(YEAR FROM created_at) as year,
                EXTRACT(MONTH FROM created_at) as month,
                SUM(total_amount) as revenue,
                COUNT(*) as invoice_count
            FROM invoices
            WHERE status = 'paid' ${dateFilter}
            GROUP BY EXTRACT(YEAR FROM created_at), EXTRACT(MONTH FROM created_at)
            ORDER BY year DESC, month DESC
            LIMIT 12
        `, params);
        const revenueByMonth = revenueByMonthResult.rows;

        // Get top customers
        const topCustomersResult = await req.pool.query(`
            SELECT
                customer_name,
                COUNT(*) as order_count,
                SUM(total_amount) as total_amount
            FROM invoices
            WHERE status = 'paid' ${dateFilter}
            GROUP BY customer_name
            ORDER BY total_amount DESC
            LIMIT 10
        `, params);
        const topCustomers = topCustomersResult.rows;

        res.json({
            summary,
            revenueByMonth,
            topCustomers
        });

    } catch (error) {
        console.error('Financial report error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get warehouse utilization report
router.get('/warehouse-utilization', authenticateToken, async (req, res) => {
    try {
        const utilizationResult = await req.pool.query(`
            SELECT
                w.id,
                w.name,
                w.type,
                w.capacity,
                w.location,
                COUNT(m.id) as materials_count,
                SUM(m.quantity) as total_quantity,
                SUM(m.weight * m.quantity) as total_weight,
                SUM(m.cost) as total_value,
                CASE
                    WHEN w.capacity > 0 THEN (SUM(m.weight * m.quantity) / w.capacity) * 100
                    ELSE 0
                END as utilization_percentage
            FROM warehouses w
            LEFT JOIN materials m ON w.id = m.warehouse_id AND m.status = 'available'
            GROUP BY w.id, w.name, w.type, w.capacity, w.location
            ORDER BY w.name
        `);

        const utilization = utilizationResult.rows;

        res.json(utilization);

    } catch (error) {
        console.error('Warehouse utilization error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;