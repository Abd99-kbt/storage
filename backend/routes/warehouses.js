const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('./auth');
const router = express.Router();

// Get all warehouses
router.get('/', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const { type, status } = req.query;

        let query = `
            SELECT w.*, u.name as manager_name
            FROM warehouses w
            LEFT JOIN users u ON w.manager_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (type) {
            query += ' AND w.type = $1';
            params.push(type);
        }

        if (status) {
            query += ` AND w.is_active = $${params.length + 1}`;
            params.push(status === 'active');
        }

        query += ' ORDER BY w.name';

        const warehousesResult = await req.pool.query(query, params);
        const warehouses = warehousesResult.rows;

        res.json(warehouses);

    } catch (error) {
        console.error('Get warehouses error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Export warehouses data
router.get('/export', authenticateToken, async (req, res) => {
    try {
        const warehousesResult = await req.pool.query(`
            SELECT w.*, u.name as manager_name
            FROM warehouses w
            LEFT JOIN users u ON w.manager_id = u.id
            ORDER BY w.name
        `);
        const warehouses = warehousesResult.rows;

        // Set headers for file download
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `warehouses_${timestamp}`;

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

            // Convert data to CSV format
            if (warehouses.length > 0) {
                const headers = Object.keys(warehouses[0]);
                const csvHeaders = headers.join(',');
                const csvRows = warehouses.map(warehouse =>
                    headers.map(header => `"${warehouse[header] || ''}"`).join(',')
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
            res.json(warehouses);
        }

    } catch (error) {
        console.error('Export warehouses error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get warehouse by ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const warehouseId = req.params.id;

        const warehouseResult = await req.pool.query(`
            SELECT w.*, u.name as manager_name
            FROM warehouses w
            LEFT JOIN users u ON w.manager_id = u.id
            WHERE w.id = $1
        `, [warehouseId]);
        const warehouse = warehouseResult.rows[0];

        if (!warehouse) {
            return res.status(404).json({ message: 'المستودع غير موجود' });
        }

        res.json(warehouse);

    } catch (error) {
        console.error('Get warehouse error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Create new warehouse
router.post('/', authenticateToken, [
    body('name').notEmpty().withMessage('اسم المستودع مطلوب'),
    body('type').isIn(['main', 'cutting', 'sorting', 'safekeeping']).withMessage('نوع المستودع غير صالح'),
    body('capacity').isNumeric().withMessage('السعة يجب أن تكون رقمية')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, type, capacity, location, manager_id } = req.body;
        const db = req.pool;

        const result = await req.pool.query(`
            INSERT INTO warehouses (name, type, capacity, location, manager_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `, [name, type, capacity, location, manager_id]);

        const newWarehouseResult = await req.pool.query('SELECT * FROM warehouses WHERE id = $1', [result.rows[0].id]);
        const newWarehouse = newWarehouseResult.rows[0];

        res.status(201).json({
            message: 'تم إنشاء المستودع بنجاح',
            warehouse: newWarehouse
        });

    } catch (error) {
        console.error('Create warehouse error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update warehouse
router.put('/:id', authenticateToken, [
    body('name').notEmpty().withMessage('اسم المستودع مطلوب'),
    body('type').isIn(['main', 'cutting', 'sorting', 'safekeeping']).withMessage('نوع المستودع غير صالح'),
    body('capacity').isNumeric().withMessage('السعة يجب أن تكون رقمية')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const warehouseId = req.params.id;
        const { name, type, capacity, location, manager_id, is_active } = req.body;
        const db = req.pool;

        const result = await req.pool.query(`
            UPDATE warehouses
            SET name = $1, type = $2, capacity = $3, location = $4, manager_id = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP
            WHERE id = $7
        `, [name, type, capacity, location, manager_id, is_active, warehouseId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'المستودع غير موجود' });
        }

        const updatedWarehouseResult = await req.pool.query('SELECT * FROM warehouses WHERE id = $1', [warehouseId]);
        const updatedWarehouse = updatedWarehouseResult.rows[0];

        res.json({
            message: 'تم تحديث المستودع بنجاح',
            warehouse: updatedWarehouse
        });

    } catch (error) {
        console.error('Update warehouse error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Delete warehouse
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const warehouseId = req.params.id;

        // Check if warehouse has materials
        const materialCountResult = await req.pool.query('SELECT COUNT(*) as count FROM materials WHERE warehouse_id = $1', [warehouseId]);
        const materialCount = parseInt(materialCountResult.rows[0].count);

        if (materialCount > 0) {
            return res.status(400).json({ message: 'لا يمكن حذف المستودع لأنه يحتوي على مواد' });
        }

        const result = await req.pool.query('DELETE FROM warehouses WHERE id = $1', [warehouseId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'المستودع غير موجود' });
        }

        res.json({ message: 'تم حذف المستودع بنجاح' });

    } catch (error) {
        console.error('Delete warehouse error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get warehouse statistics
router.get('/:id/stats', authenticateToken, async (req, res) => {
    try {
        const warehouseId = req.params.id;
        const db = req.pool;

        const statsResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_materials,
                SUM(quantity) as total_quantity,
                SUM(weight * quantity) as total_weight,
                SUM(cost) as total_value
            FROM materials
            WHERE warehouse_id = $1 AND status = 'available'
        `, [warehouseId]);
        const stats = statsResult.rows[0];

        res.json(stats);

    } catch (error) {
        console.error('Get warehouse stats error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Transfer materials between warehouses
router.post('/transfer', authenticateToken, [
    body('material_id').isNumeric().withMessage('رقم المادة مطلوب'),
    body('from_warehouse_id').isNumeric().withMessage('مستودع المصدر مطلوب'),
    body('to_warehouse_id').isNumeric().withMessage('مستودع الهدف مطلوب'),
    body('quantity').isNumeric().withMessage('الكمية مطلوبة')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { material_id, from_warehouse_id, to_warehouse_id, quantity, notes } = req.body;
        const db = req.pool;
        const userId = req.user.id;

        // Check if material exists in source warehouse
        const materialResult = await req.pool.query('SELECT * FROM materials WHERE id = $1 AND warehouse_id = $2',
            [material_id, from_warehouse_id]);
        const material = materialResult.rows[0];

        if (!material) {
            return res.status(404).json({ message: 'المادة غير موجودة في المستودع المصدر' });
        }

        if (material.quantity < quantity) {
            return res.status(400).json({ message: 'الكمية غير كافية في المستودع المصدر' });
        }

        // Start transaction
        await req.pool.query('BEGIN');

        try {
            // Update source warehouse quantity
            await req.pool.query('UPDATE materials SET quantity = quantity - $1 WHERE id = $2',
                [quantity, material_id]);

            // Check if material exists in target warehouse
            const targetMaterialResult = await req.pool.query('SELECT * FROM materials WHERE name = $1 AND warehouse_id = $2',
                [material.name, to_warehouse_id]);
            const targetMaterial = targetMaterialResult.rows[0];

            if (targetMaterial) {
                // Update existing material in target warehouse
                await req.pool.query('UPDATE materials SET quantity = quantity + $1 WHERE id = $2',
                    [quantity, targetMaterial.id]);
            } else {
                // Insert new material in target warehouse
                await req.pool.query(`
                    INSERT INTO materials (name, weight, quantity, length, width, type, grammage,
                                         invoice_number, quality, roll_number, warehouse_id, source, cost)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                `, [
                    material.name, material.weight, quantity, material.length, material.width,
                    material.type, material.grammage, material.invoice_number, material.quality,
                    material.roll_number, to_warehouse_id, material.source, material.cost
                ]);
            }

            // Record stock movement
            await req.pool.query(`
                INSERT INTO stock_movements (material_id, warehouse_id, movement_type, quantity, weight,
                                           reference_id, reference_type, notes, created_by)
                VALUES ($1, $2, 'transfer_out', $3, $4, $5, $6, $7, $8)
            `, [material_id, from_warehouse_id, quantity, material.weight * quantity,
                to_warehouse_id, 'warehouse_transfer', notes, userId]);

            await req.pool.query(`
                INSERT INTO stock_movements (material_id, warehouse_id, movement_type, quantity, weight,
                                           reference_id, reference_type, notes, created_by)
                VALUES ($1, $2, 'transfer_in', $3, $4, $5, $6, $7, $8)
            `, [material_id, to_warehouse_id, quantity, material.weight * quantity,
                from_warehouse_id, 'warehouse_transfer', notes, userId]);

            // Commit transaction
            await req.pool.query('COMMIT');

            res.json({ message: 'تم نقل المواد بنجاح' });

        } catch (error) {
            // Rollback transaction
            await req.pool.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Transfer materials error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get warehouse activity report
router.get('/:id/activity-report', authenticateToken, async (req, res) => {
    try {
        const warehouseId = req.params.id;
        const { period } = req.query;

        let dateFilter = '';
        const params = [warehouseId];

        if (period === 'today') {
            dateFilter = "AND DATE(sm.created_at) = CURRENT_DATE";
        } else if (period === 'week') {
            dateFilter = "AND sm.created_at >= CURRENT_DATE - INTERVAL '7 days'";
        } else if (period === 'month') {
            dateFilter = "AND sm.created_at >= CURRENT_DATE - INTERVAL '30 days'";
        }

        const activityResult = await req.pool.query(`
            SELECT
                sm.movement_type,
                COUNT(*) as movement_count,
                SUM(sm.quantity) as total_quantity,
                SUM(sm.weight) as total_weight,
                COUNT(DISTINCT sm.material_id) as materials_affected
            FROM stock_movements sm
            WHERE sm.warehouse_id = $1 ${dateFilter}
            GROUP BY sm.movement_type
            ORDER BY movement_count DESC
        `, params);

        res.json(activityResult.rows);

    } catch (error) {
        console.error('Get warehouse activity report error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get warehouse utilization details
router.get('/:id/utilization', authenticateToken, async (req, res) => {
    try {
        const warehouseId = req.params.id;

        const utilizationResult = await req.pool.query(`
            SELECT
                w.name,
                w.type,
                w.capacity,
                w.location,
                COUNT(m.id) as materials_count,
                SUM(m.quantity) as total_quantity,
                SUM(m.weight * m.quantity) as total_weight,
                SUM(m.cost) as total_value,
                CASE
                    WHEN w.capacity > 0 THEN ROUND((SUM(m.weight * m.quantity) / w.capacity) * 100, 2)
                    ELSE 0
                END as utilization_percentage,
                CASE
                    WHEN w.capacity > 0 THEN w.capacity - SUM(m.weight * m.quantity)
                    ELSE 0
                END as remaining_capacity
            FROM warehouses w
            LEFT JOIN materials m ON w.id = m.warehouse_id AND m.status = 'available'
            WHERE w.id = $1
            GROUP BY w.id, w.name, w.type, w.capacity, w.location
        `, [warehouseId]);

        res.json(utilizationResult.rows[0]);

    } catch (error) {
        console.error('Get warehouse utilization error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get warehouse performance metrics
router.get('/:id/performance', authenticateToken, async (req, res) => {
    try {
        const warehouseId = req.params.id;

        // Get turnover rate (materials in/out over time)
        const turnoverResult = await req.pool.query(`
            SELECT
                COUNT(*) as total_movements,
                SUM(quantity) as total_quantity_moved,
                AVG(quantity) as avg_quantity_per_movement,
                COUNT(DISTINCT material_id) as unique_materials_handled
            FROM stock_movements
            WHERE warehouse_id = $1
            AND created_at >= CURRENT_DATE - INTERVAL '30 days'
        `, [warehouseId]);

        // Get efficiency metrics
        const efficiencyResult = await req.pool.query(`
            SELECT
                COUNT(CASE WHEN movement_type IN ('in', 'transfer_in') THEN 1 END) as inbound_movements,
                COUNT(CASE WHEN movement_type IN ('out', 'transfer_out') THEN 1 END) as outbound_movements,
                ROUND(
                    COUNT(CASE WHEN movement_type IN ('out', 'transfer_out') THEN 1 END)::numeric /
                    NULLIF(COUNT(*), 0) * 100, 2
                ) as outbound_percentage
            FROM stock_movements
            WHERE warehouse_id = $1
            AND created_at >= CURRENT_DATE - INTERVAL '30 days'
        `, [warehouseId]);

        res.json({
            turnover: turnoverResult.rows[0],
            efficiency: efficiencyResult.rows[0]
        });

    } catch (error) {
        console.error('Get warehouse performance error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Bulk operations for warehouses
router.post('/bulk-operations', authenticateToken, [
    body('warehouse_ids').isArray().withMessage('يجب تحديد المستودعات'),
    body('operation').isIn(['activate', 'deactivate', 'delete', 'update_manager'])
        .withMessage('نوع العملية غير صالح')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { warehouse_ids, operation, data } = req.body;

        switch (operation) {
            case 'activate':
                for (const warehouseId of warehouse_ids) {
                    await req.pool.query('UPDATE warehouses SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                        [warehouseId]);
                }
                break;

            case 'deactivate':
                for (const warehouseId of warehouse_ids) {
                    await req.pool.query('UPDATE warehouses SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                        [warehouseId]);
                }
                break;

            case 'update_manager':
                for (const warehouseId of warehouse_ids) {
                    await req.pool.query('UPDATE warehouses SET manager_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                        [data.manager_id, warehouseId]);
                }
                break;

            case 'delete':
                for (const warehouseId of warehouse_ids) {
                    // Check if warehouse has materials
                    const materialCountResult = await req.pool.query('SELECT COUNT(*) as count FROM materials WHERE warehouse_id = $1',
                        [warehouseId]);
                    const materialCount = parseInt(materialCountResult.rows[0].count);

                    if (materialCount > 0) {
                        return res.status(400).json({ message: `لا يمكن حذف المستودع ${warehouseId} لأنه يحتوي على مواد` });
                    }

                    await req.pool.query('DELETE FROM warehouses WHERE id = $1', [warehouseId]);
                }
                break;
        }

        res.json({ message: 'تم تنفيذ العملية بنجاح' });

    } catch (error) {
        console.error('Bulk warehouse operations error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get warehouse alerts
router.get('/:id/alerts', authenticateToken, async (req, res) => {
    try {
        const warehouseId = req.params.id;
        const alerts = [];

        // Check capacity utilization
        const utilizationResult = await req.pool.query(`
            SELECT
                (SUM(m.weight * m.quantity) / w.capacity) * 100 as utilization_percentage
            FROM warehouses w
            LEFT JOIN materials m ON w.id = m.warehouse_id AND m.status = 'available'
            WHERE w.id = $1
            GROUP BY w.id, w.capacity
        `, [warehouseId]);

        const utilization = parseFloat(utilizationResult.rows[0]?.utilization_percentage || 0);

        if (utilization > 90) {
            alerts.push({
                type: 'capacity',
                severity: 'high',
                message: `المستودع مكتظ بنسبة ${utilization.toFixed(1)}%`,
                recommendation: 'نقل بعض المواد إلى مستودعات أخرى'
            });
        } else if (utilization > 75) {
            alerts.push({
                type: 'capacity',
                severity: 'medium',
                message: `المستودع مستغل بنسبة ${utilization.toFixed(1)}%`,
                recommendation: 'مراقبة مستويات المخزون'
            });
        }

        // Check for low stock materials
        const lowStockResult = await req.pool.query(`
            SELECT COUNT(*) as count
            FROM materials
            WHERE warehouse_id = $1 AND quantity < 10 AND status = 'available'
        `, [warehouseId]);

        const lowStockCount = parseInt(lowStockResult.rows[0].count);
        if (lowStockCount > 0) {
            alerts.push({
                type: 'stock',
                severity: 'medium',
                message: `${lowStockCount} مادة منخفضة الكمية`,
                recommendation: 'طلب مواد جديدة'
            });
        }

        // Check for expired materials
        const expiredResult = await req.pool.query(`
            SELECT COUNT(*) as count
            FROM materials
            WHERE warehouse_id = $1 AND status = 'expired'
        `, [warehouseId]);

        const expiredCount = parseInt(expiredResult.rows[0].count);
        if (expiredCount > 0) {
            alerts.push({
                type: 'expired',
                severity: 'high',
                message: `${expiredCount} مادة منتهية الصلاحية`,
                recommendation: 'مراجعة وإزالة المواد منتهية الصلاحية'
            });
        }

        res.json(alerts);

    } catch (error) {
        console.error('Get warehouse alerts error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get warehouse comparison report
router.get('/comparison-report', authenticateToken, async (req, res) => {
    try {
        const comparisonResult = await req.pool.query(`
            SELECT
                w.name,
                w.type,
                w.capacity,
                COUNT(m.id) as materials_count,
                SUM(m.quantity) as total_quantity,
                SUM(m.weight * m.quantity) as total_weight,
                SUM(m.cost) as total_value,
                CASE
                    WHEN w.capacity > 0 THEN ROUND((SUM(m.weight * m.quantity) / w.capacity) * 100, 2)
                    ELSE 0
                END as utilization_percentage,
                AVG(sm.quantity) as avg_movement_quantity
            FROM warehouses w
            LEFT JOIN materials m ON w.id = m.warehouse_id AND m.status = 'available'
            LEFT JOIN stock_movements sm ON w.id = sm.warehouse_id
            GROUP BY w.id, w.name, w.type, w.capacity
            ORDER BY total_value DESC
        `);

        res.json(comparisonResult.rows);

    } catch (error) {
        console.error('Get warehouse comparison report error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;