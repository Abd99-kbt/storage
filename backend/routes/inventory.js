const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('./auth');
const router = express.Router();

// Create inventory count
router.post('/count', authenticateToken, [
    body('warehouse_id').isNumeric().withMessage('رقم المستودع مطلوب'),
    body('material_id').isNumeric().withMessage('رقم المادة مطلوب'),
    body('counted_quantity').isNumeric().withMessage('الكمية المعدودة مطلوبة')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { warehouse_id, material_id, counted_quantity, notes } = req.body;
        const userId = req.user.id;

        // Get current system quantity
        const materialResult = await req.pool.query(`
            SELECT quantity, name FROM materials WHERE id = $1
        `, [material_id]);

        if (materialResult.rows.length === 0) {
            return res.status(404).json({ message: 'المادة غير موجودة' });
        }

        const systemQuantity = materialResult.rows[0].quantity;
        const variance = counted_quantity - systemQuantity;

        // Insert inventory count record
        const result = await req.pool.query(`
            INSERT INTO inventory_counts (warehouse_id, material_id, counted_quantity, system_quantity, variance, counted_by, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        `, [warehouse_id, material_id, counted_quantity, systemQuantity, variance, userId, notes]);

        res.status(201).json({
            message: 'تم تسجيل الجرد بنجاح',
            countId: result.rows[0].id,
            variance: variance
        });

    } catch (error) {
        console.error('Create inventory count error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get inventory counts
router.get('/counts', authenticateToken, async (req, res) => {
    try {
        const { warehouse_id, status, date_from, date_to } = req.query;

        let whereClause = "WHERE 1=1";
        const params = [];

        if (warehouse_id) {
            whereClause += ` AND ic.warehouse_id = $${params.length + 1}`;
            params.push(warehouse_id);
        }

        if (status) {
            whereClause += ` AND ic.status = $${params.length + 1}`;
            params.push(status);
        }

        if (date_from) {
            whereClause += ` AND DATE(ic.count_date) >= $${params.length + 1}`;
            params.push(date_from);
        }

        if (date_to) {
            whereClause += ` AND DATE(ic.count_date) <= $${params.length + 1}`;
            params.push(date_to);
        }

        let query = `
            SELECT ic.*, w.name as warehouse_name, m.name as material_name, u.name as counted_by_name
            FROM inventory_counts ic
            LEFT JOIN warehouses w ON ic.warehouse_id = w.id
            LEFT JOIN materials m ON ic.material_id = m.id
            LEFT JOIN users u ON ic.counted_by = u.id
            ${whereClause}
        `;

        query += ' ORDER BY ic.count_date DESC, ic.created_at DESC';

        const countsResult = await req.pool.query(query, params);
        const counts = countsResult.rows;

        res.json(counts);

    } catch (error) {
        console.error('Get inventory counts error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Approve inventory count and update material quantity
router.put('/counts/:id/approve', authenticateToken, async (req, res) => {
    try {
        const countId = req.params.id;

        // Get count details
        const countResult = await req.pool.query(`
            SELECT * FROM inventory_counts WHERE id = $1
        `, [countId]);

        if (countResult.rows.length === 0) {
            return res.status(404).json({ message: 'سجل الجرد غير موجود' });
        }

        const count = countResult.rows[0];

        // Update material quantity
        await req.pool.query(`
            UPDATE materials
            SET quantity = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [count.counted_quantity, count.material_id]);

        // Update count status
        await req.pool.query(`
            UPDATE inventory_counts
            SET status = 'approved', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [countId]);

        // Record stock movement for the adjustment
        await req.pool.query(`
            INSERT INTO stock_movements (material_id, warehouse_id, movement_type, quantity, reference_id, reference_type, notes, created_by)
            VALUES ($1, $2, 'adjustment', $3, $4, 'inventory_count', 'تعديل بناءً على الجرد', $5)
        `, [count.material_id, count.warehouse_id, count.variance, countId, req.user.id]);

        res.json({ message: 'تم اعتماد الجرد وتحديث الكمية بنجاح' });

    } catch (error) {
        console.error('Approve inventory count error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get inventory variance report
router.get('/variance-report', authenticateToken, async (req, res) => {
    try {
        const { warehouse_id, date_from, date_to } = req.query;

        let query = `
            SELECT
                ic.*,
                w.name as warehouse_name,
                m.name as material_name,
                u.name as counted_by_name,
                CASE
                    WHEN ABS(ic.variance) > 0 THEN 'variance'
                    ELSE 'accurate'
                END as accuracy_status
            FROM inventory_counts ic
            LEFT JOIN warehouses w ON ic.warehouse_id = w.id
            LEFT JOIN materials m ON ic.material_id = m.id
            LEFT JOIN users u ON ic.counted_by = u.id
            WHERE ic.status = 'approved'
        `;
        const params = [];

        if (warehouse_id) {
            query += ` AND ic.warehouse_id = $${params.length + 1}`;
            params.push(warehouse_id);
        }

        if (date_from) {
            query += ` AND DATE(ic.count_date) >= $${params.length + 1}`;
            params.push(date_from);
        }

        if (date_to) {
            query += ` AND DATE(ic.count_date) <= $${params.length + 1}`;
            params.push(date_to);
        }

        query += ' ORDER BY ABS(ic.variance) DESC';

        const varianceResult = await req.pool.query(query, params);
        const variances = varianceResult.rows;

        res.json(variances);

    } catch (error) {
        console.error('Get inventory variance report error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get inventory summary
router.get('/summary', authenticateToken, async (req, res) => {
    try {
        const { warehouse_id } = req.query;

        let warehouseFilter = '';
        const params = [];

        if (warehouse_id) {
            warehouseFilter = 'WHERE m.warehouse_id = $1';
            params.push(warehouse_id);
        }

        const summaryResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_materials,
                SUM(quantity) as total_quantity,
                SUM(weight * quantity) as total_weight,
                SUM(cost) as total_value,
                COUNT(CASE WHEN quantity < 10 THEN 1 END) as low_stock_items,
                COUNT(CASE WHEN status != 'available' THEN 1 END) as unavailable_items,
                AVG(CASE WHEN quantity > 0 THEN cost/quantity ELSE 0 END) as avg_unit_cost
            FROM materials m
            ${warehouseFilter}
        `, params);

        const summary = summaryResult.rows[0];

        // Get materials by type
        const byTypeResult = await req.pool.query(`
            SELECT
                type,
                COUNT(*) as count,
                SUM(quantity) as total_quantity,
                SUM(cost) as total_value
            FROM materials m
            ${warehouseFilter}
            GROUP BY type
            ORDER BY total_value DESC
        `, params);

        // Get materials by quality
        const byQualityResult = await req.pool.query(`
            SELECT
                quality,
                COUNT(*) as count,
                SUM(quantity) as total_quantity
            FROM materials m
            ${warehouseFilter}
            GROUP BY quality
            ORDER BY count DESC
        `, params);

        res.json({
            summary,
            byType: byTypeResult.rows,
            byQuality: byQualityResult.rows
        });

    } catch (error) {
        console.error('Get inventory summary error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Start inventory count session
router.post('/count-session', authenticateToken, [
    body('warehouse_id').isNumeric().withMessage('رقم المستودع مطلوب'),
    body('materials').isArray().withMessage('قائمة المواد مطلوبة')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { warehouse_id, materials } = req.body;
        const userId = req.user.id;

        // Insert multiple inventory count records
        const insertPromises = materials.map(material =>
            req.pool.query(`
                INSERT INTO inventory_counts (warehouse_id, material_id, system_quantity, counted_by, status)
                SELECT $1, $2, quantity, $3, 'pending'
                FROM materials WHERE id = $2
            `, [warehouse_id, material.material_id, userId])
        );

        await Promise.all(insertPromises);

        res.json({ message: 'تم بدء جلسة الجرد بنجاح' });

    } catch (error) {
        console.error('Start inventory count session error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;