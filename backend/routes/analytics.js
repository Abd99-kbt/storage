const express = require('express');
const { authenticateToken } = require('./auth');
const router = express.Router();

// Get advanced warehouse analytics
router.get('/warehouses/advanced', authenticateToken, async (req, res) => {
    try {
        const { warehouse_id, period = '30' } = req.query;

        // Build query dynamically based on warehouse_id
        let whereClause = "WHERE w.is_active = true";
        let joinClause = "";

        if (warehouse_id) {
            whereClause += ` AND w.id = ${warehouse_id}`;
        }

        joinClause = `AND sm.created_at >= CURRENT_DATE - INTERVAL '${period} days'`;

        // Comprehensive warehouse analytics
        const analyticsResult = await req.pool.query(`
            SELECT
                w.id,
                w.name,
                w.type,
                w.capacity,
                w.location,

                -- Current inventory metrics
                COUNT(DISTINCT m.id) as total_materials,
                COALESCE(SUM(m.quantity), 0) as total_quantity,
                COALESCE(SUM(m.weight * m.quantity), 0) as total_weight,
                COALESCE(SUM(m.cost), 0) as total_value,
                CASE
                    WHEN w.capacity > 0 THEN ROUND((COALESCE(SUM(m.weight * m.quantity), 0) / w.capacity) * 100, 2)
                    ELSE 0
                END as utilization_percentage,

                -- Movement analytics (last ${period} days)
                COUNT(DISTINCT sm.id) as total_movements,
                COALESCE(SUM(CASE WHEN sm.movement_type IN ('in', 'transfer_in') THEN sm.quantity ELSE 0 END), 0) as inbound_quantity,
                COALESCE(SUM(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity ELSE 0 END), 0) as outbound_quantity,
                COUNT(DISTINCT sm.material_id) as unique_materials_moved,

                -- Performance metrics
                AVG(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity END) as avg_outbound_quantity,
                COUNT(CASE WHEN sm.created_at >= CURRENT_DATE - INTERVAL '${period} days' THEN 1 END) as recent_movements,

                -- Material diversity
                COUNT(DISTINCT m.type) as material_types_count,
                COUNT(DISTINCT m.quality) as quality_types_count,

                -- Cost analysis
                AVG(m.cost) as avg_material_cost,
                MIN(m.cost) as min_material_cost,
                MAX(m.cost) as max_material_cost,

                -- Activity trends
                COUNT(CASE WHEN DATE(sm.created_at) = CURRENT_DATE THEN 1 END) as today_movements,
                COUNT(CASE WHEN DATE(sm.created_at) = CURRENT_DATE - INTERVAL '1 day' THEN 1 END) as yesterday_movements

            FROM warehouses w
            LEFT JOIN materials m ON w.id = m.warehouse_id AND m.status = 'available'
            LEFT JOIN stock_movements sm ON w.id = sm.warehouse_id ${joinClause}
            ${whereClause}
            GROUP BY w.id, w.name, w.type, w.capacity, w.location
            ORDER BY total_value DESC
        `);

        const analytics = analyticsResult.rows;

        res.json(analytics);

    } catch (error) {
        console.error('Get advanced warehouse analytics error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get warehouse performance trends
router.get('/warehouses/trends', authenticateToken, async (req, res) => {
    try {
        const { warehouse_id, days = 30 } = req.query;

        let warehouseFilter = '';
        const params = [];

        if (warehouse_id) {
            warehouseFilter = 'WHERE sm.warehouse_id = $1';
            params.push(warehouse_id);
        } else {
            warehouseFilter = 'WHERE 1=1';
        }

        // Get daily movement trends
        const trendsResult = await req.pool.query(`
            SELECT
                DATE(sm.created_at) as date,
                sm.warehouse_id,
                w.name as warehouse_name,
                COUNT(*) as movements_count,
                SUM(CASE WHEN sm.movement_type IN ('in', 'transfer_in') THEN sm.quantity ELSE 0 END) as daily_inbound,
                SUM(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity ELSE 0 END) as daily_outbound,
                COUNT(DISTINCT sm.material_id) as materials_moved
            FROM stock_movements sm
            LEFT JOIN warehouses w ON sm.warehouse_id = w.id
            ${warehouseFilter}
            AND sm.created_at >= CURRENT_DATE - INTERVAL '${days} days'
            GROUP BY DATE(sm.created_at), sm.warehouse_id, w.name
            ORDER BY date DESC
        `, params);

        const trends = trendsResult.rows;

        res.json(trends);

    } catch (error) {
        console.error('Get warehouse trends error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get material analytics
router.get('/materials/advanced', authenticateToken, async (req, res) => {
    try {
        const { material_id, warehouse_id } = req.query;

        // Build query dynamically
        let whereClause = "WHERE m.status = 'available'";
        let joinConditions = [];

        if (material_id) {
            whereClause += ` AND m.id = ${material_id}`;
        }

        if (warehouse_id) {
            whereClause += ` AND m.warehouse_id = ${warehouse_id}`;
        }

        // Advanced material analytics
        const analyticsResult = await req.pool.query(`
            SELECT
                m.id,
                m.name,
                m.type,
                m.quality,
                m.warehouse_id,
                w.name as warehouse_name,

                -- Current status
                m.quantity as current_quantity,
                m.weight,
                m.cost,
                (m.quantity * m.cost) as total_value,

                -- Movement history (last 90 days)
                COUNT(sm.id) as total_movements,
                COALESCE(SUM(CASE WHEN sm.movement_type IN ('in', 'transfer_in') THEN sm.quantity ELSE 0 END), 0) as total_inbound,
                COALESCE(SUM(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity ELSE 0 END), 0) as total_outbound,
                MAX(sm.created_at) as last_movement_date,

                -- Usage patterns
                AVG(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity END) as avg_usage_quantity,
                COUNT(DISTINCT DATE(sm.created_at)) as active_days,

                -- Cost analysis
                MIN(oi.unit_price) as min_selling_price,
                MAX(oi.unit_price) as max_selling_price,
                AVG(oi.unit_price) as avg_selling_price,
                COALESCE(SUM(oi.total_price), 0) as total_revenue,

                -- Efficiency metrics
                CASE
                    WHEN COUNT(oi.id) > 0 THEN ROUND((COALESCE(SUM(oi.total_price), 0) / (m.cost * m.quantity)) * 100, 2)
                    ELSE 0
                END as profit_margin_percentage,

                -- Stock turnover rate
                CASE
                    WHEN AVG(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity END) > 0
                    THEN ROUND(m.quantity / AVG(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity END), 1)
                    ELSE 0
                END as stock_turnover_days

            FROM materials m
            LEFT JOIN warehouses w ON m.warehouse_id = w.id
            LEFT JOIN stock_movements sm ON m.id = sm.material_id
                AND sm.created_at >= CURRENT_DATE - INTERVAL '90 days'
            LEFT JOIN order_items oi ON m.id = oi.material_id
            ${whereClause}
            GROUP BY m.id, m.name, m.type, m.quality, m.quantity, m.weight, m.cost, m.warehouse_id, w.name
            ORDER BY total_revenue DESC, total_movements DESC
        `);

        const analytics = analyticsResult.rows;

        res.json(analytics);

    } catch (error) {
        console.error('Get advanced material analytics error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get predictive analytics
router.get('/predictive', authenticateToken, async (req, res) => {
    try {
        // Stock level predictions based on historical data
        const predictionsResult = await req.pool.query(`
            SELECT
                m.id,
                m.name,
                m.warehouse_id,
                w.name as warehouse_name,
                m.quantity as current_quantity,

                -- Calculate daily consumption rate
                AVG(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity END) as daily_consumption_rate,

                -- Predict days until stockout
                CASE
                    WHEN AVG(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity END) > 0
                    THEN ROUND(m.quantity / AVG(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity END))
                    ELSE 999
                END as predicted_days_to_stockout,

                -- Predict reorder date
                CASE
                    WHEN AVG(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity END) > 0
                    THEN CURRENT_DATE + INTERVAL '1 day' * ROUND(m.quantity / AVG(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity END))
                    ELSE CURRENT_DATE + INTERVAL '30 days'
                END as suggested_reorder_date,

                -- Stock status prediction
                CASE
                    WHEN m.quantity < 10 THEN 'critical'
                    WHEN m.quantity < 50 THEN 'low'
                    WHEN AVG(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity END) * 7 > m.quantity THEN 'reorder_soon'
                    ELSE 'adequate'
                END as stock_status

            FROM materials m
            LEFT JOIN warehouses w ON m.warehouse_id = w.id
            LEFT JOIN stock_movements sm ON m.id = sm.material_id
                AND sm.created_at >= CURRENT_DATE - INTERVAL '30 days'
            WHERE m.status = 'available'
            GROUP BY m.id, m.name, m.quantity, m.warehouse_id, w.name
            HAVING AVG(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN sm.quantity END) > 0
            ORDER BY predicted_days_to_stockout ASC
        `);

        const predictions = predictionsResult.rows;

        res.json(predictions);

    } catch (error) {
        console.error('Get predictive analytics error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get warehouse efficiency metrics
router.get('/warehouses/efficiency', authenticateToken, async (req, res) => {
    try {
        const { warehouse_id } = req.query;

        // Build query dynamically
        let whereClause = "WHERE w.is_active = true";

        if (warehouse_id) {
            whereClause += ` AND w.id = ${warehouse_id}`;
        }

        const efficiencyResult = await req.pool.query(`
            SELECT
                w.id,
                w.name,
                w.type,

                -- Space utilization efficiency
                CASE
                    WHEN w.capacity > 0 THEN ROUND((COALESCE(SUM(m.weight * m.quantity), 0) / w.capacity) * 100, 2)
                    ELSE 0
                END as space_utilization,

                -- Material handling efficiency
                COUNT(DISTINCT sm.material_id) as unique_materials_handled,
                COUNT(sm.id) as total_handling_operations,
                CASE
                    WHEN COUNT(sm.id) > 0 THEN ROUND(COUNT(DISTINCT sm.material_id)::numeric / COUNT(sm.id), 2)
                    ELSE 0
                END as material_diversity_ratio,

                -- Cost efficiency
                COALESCE(SUM(m.cost), 0) as total_inventory_cost,
                CASE
                    WHEN COUNT(DISTINCT sm.material_id) > 0 THEN ROUND(COALESCE(SUM(m.cost), 0) / COUNT(DISTINCT sm.material_id), 2)
                    ELSE 0
                END as avg_cost_per_material_type,

                -- Operational efficiency
                COUNT(CASE WHEN sm.movement_type IN ('in', 'transfer_in') THEN 1 END) as inbound_operations,
                COUNT(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN 1 END) as outbound_operations,
                CASE
                    WHEN COUNT(CASE WHEN sm.movement_type IN ('in', 'transfer_in') THEN 1 END) > 0
                    THEN ROUND(
                        COUNT(CASE WHEN sm.movement_type IN ('out', 'transfer_out') THEN 1 END)::numeric /
                        COUNT(CASE WHEN sm.movement_type IN ('in', 'transfer_in') THEN 1 END) * 100, 2
                    )
                    ELSE 0
                END as outbound_to_inbound_ratio,

                -- Quality distribution
                COUNT(CASE WHEN m.quality = 'ممتاز' THEN 1 END) as excellent_quality_count,
                COUNT(CASE WHEN m.quality = 'جيد' THEN 1 END) as good_quality_count,
                COUNT(CASE WHEN m.quality = 'متوسط' THEN 1 END) as average_quality_count

            FROM warehouses w
            LEFT JOIN materials m ON w.id = m.warehouse_id AND m.status = 'available'
            LEFT JOIN stock_movements sm ON w.id = sm.warehouse_id
                AND sm.created_at >= CURRENT_DATE - INTERVAL '30 days'
            ${whereClause}
            GROUP BY w.id, w.name, w.type, w.capacity
            ORDER BY space_utilization DESC
        `);

        const efficiency = efficiencyResult.rows;

        res.json(efficiency);

    } catch (error) {
        console.error('Get warehouse efficiency error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;