const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('./auth');
const { NotificationService } = require('./notifications');
const router = express.Router();

// Get all materials
router.get('/', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const { warehouse_id, type, quality, status } = req.query;

        let query = `
            SELECT m.*, w.name as warehouse_name
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

        query += ' ORDER BY m.created_at DESC';

        const materialsResult = await req.pool.query(query, params);
        const materials = materialsResult.rows;

        res.json(materials);

    } catch (error) {
        console.error('Get materials error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get material by ID
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;
        const materialId = req.params.id;

        const materialResult = await req.pool.query(`
            SELECT m.*, w.name as warehouse_name
            FROM materials m
            LEFT JOIN warehouses w ON m.warehouse_id = w.id
            WHERE m.id = $1
        `, [materialId]);
        const material = materialResult.rows[0];

        if (!material) {
            return res.status(404).json({ message: 'المادة غير موجودة' });
        }

        res.json(material);

    } catch (error) {
        console.error('Get material error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Create new material
router.post('/', authenticateToken, [
    body('name').notEmpty().withMessage('اسم المادة مطلوب'),
    body('weight').isNumeric().withMessage('الوزن يجب أن يكون رقمياً'),
    body('quantity').isNumeric().withMessage('الكمية يجب أن تكون رقمية'),
    body('warehouse_id').isNumeric().withMessage('رقم المستودع مطلوب')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const {
            name, weight, quantity, length, width, type, grammage,
            invoice_number, quality, roll_number, warehouse_id, source, cost
        } = req.body;
        
        const db = req.pool;
        const userId = req.user.id;

        const result = await req.pool.query(`
            INSERT INTO materials (name, weight, quantity, length, width, type, grammage,
                                 invoice_number, quality, roll_number, warehouse_id, source, cost)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id
        `, [
            name, weight, quantity, length, width, type, grammage,
            invoice_number, quality, roll_number, warehouse_id, source, cost
        ]);

        const materialId = result.rows[0].id;

        // Record stock movement
        await req.pool.query(`
            INSERT INTO stock_movements (material_id, warehouse_id, movement_type, quantity, weight,
                                        reference_id, reference_type, notes, created_by)
            VALUES ($1, $2, 'in', $3, $4, $5, $6, $7, $8)
        `, [materialId, warehouse_id, quantity, weight * quantity,
            materialId, 'material_creation', 'إضافة مادة جديدة', userId]);

        const newMaterialResult = await req.pool.query('SELECT * FROM materials WHERE id = $1', [materialId]);
        const newMaterial = newMaterialResult.rows[0];

        // Create notification for new material
        await NotificationService.createNotification(req.pool, {
            user_id: 1, // Admin user
            title: 'مادة جديدة تم إضافتها',
            message: `تم إضافة المادة "${name}" بكمية ${quantity} وحدة`,
            type: 'new_material',
            priority: 'medium',
            related_id: materialId,
            related_type: 'material',
            data: { material_name: name, quantity: quantity, warehouse_id: warehouse_id },
            created_by: userId
        });

        res.status(201).json({
            message: 'تم إنشاء المادة بنجاح',
            material: newMaterial
        });

    } catch (error) {
        console.error('Create material error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update material
router.put('/:id', authenticateToken, [
    body('name').notEmpty().withMessage('اسم المادة مطلوب'),
    body('weight').isNumeric().withMessage('الوزن يجب أن يكون رقمياً'),
    body('quantity').isNumeric().withMessage('الكمية يجب أن تكون رقمية'),
    body('warehouse_id').isNumeric().withMessage('رقم المستودع مطلوب')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const materialId = req.params.id;
        const {
            name, weight, quantity, length, width, type, grammage,
            invoice_number, quality, roll_number, warehouse_id, source, cost, status
        } = req.body;
        

        const result = await req.pool.query(`
            UPDATE materials
            SET name = $1, weight = $2, quantity = $3, length = $4, width = $5, type = $6, grammage = $7,
                invoice_number = $8, quality = $9, roll_number = $10, warehouse_id = $11, source = $12, cost = $13,
                status = $14, updated_at = CURRENT_TIMESTAMP
            WHERE id = $15
        `, [
            name, weight, quantity, length, width, type, grammage,
            invoice_number, quality, roll_number, warehouse_id, source, cost, status, materialId
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'المادة غير موجودة' });
        }

        const updatedMaterialResult = await req.pool.query('SELECT * FROM materials WHERE id = $1', [materialId]);
        const updatedMaterial = updatedMaterialResult.rows[0];

        // Check for low stock and create notification if needed
        if (updatedMaterial.quantity <= 10 && updatedMaterial.status === 'available') {
            await NotificationService.createLowStockNotification(req.pool, updatedMaterial, userId);
        }

        res.json({
            message: 'تم تحديث المادة بنجاح',
            material: updatedMaterial
        });

    } catch (error) {
        console.error('Update material error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Delete material
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const materialId = req.params.id;
        const db = req.pool;

        // Check if material is used in orders
        const orderCountResult = await req.pool.query('SELECT COUNT(*) as count FROM order_items WHERE material_id = $1', [materialId]);
        const orderCount = parseInt(orderCountResult.rows[0].count);

        if (orderCount > 0) {
            return res.status(400).json({ message: 'لا يمكن حذف المادة لأنها مستخدمة في طلبات' });
        }

        const result = await req.pool.query('DELETE FROM materials WHERE id = $1', [materialId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'المادة غير موجودة' });
        }

        res.json({ message: 'تم حذف المادة بنجاح' });

    } catch (error) {
        console.error('Delete material error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get material stock movements
router.get('/:id/movements', authenticateToken, async (req, res) => {
    try {
        const materialId = req.params.id;
        const db = req.pool;

        const movementsResult = await req.pool.query(`
            SELECT sm.*, u.name as user_name, w.name as warehouse_name
            FROM stock_movements sm
            LEFT JOIN users u ON sm.created_by = u.id
            LEFT JOIN warehouses w ON sm.warehouse_id = w.id
            WHERE sm.material_id = $1
            ORDER BY sm.created_at DESC
        `, [materialId]);
        const movements = movementsResult.rows;

        res.json(movements);

    } catch (error) {
        console.error('Get material movements error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update material status
router.patch('/:id/status', authenticateToken, [
    body('status').isIn(['available', 'reserved', 'damaged', 'expired']).withMessage('حالة المادة غير صالحة')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const materialId = req.params.id;
        const { status } = req.body;
        const db = req.pool;

        const result = await req.pool.query('UPDATE materials SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [status, materialId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'المادة غير موجودة' });
        }

        res.json({ message: 'تم تحديث حالة المادة بنجاح' });

    } catch (error) {
        console.error('Update material status error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get materials statistics
router.get('/stats/summary', authenticateToken, async (req, res) => {
    try {
        const db = req.pool;

        const statsResult = await req.pool.query(`
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
        const stats = statsResult.rows[0];

        // Get materials by type
        const byTypeResult = await req.pool.query(`
            SELECT type, COUNT(*) as count, SUM(quantity) as total_quantity
            FROM materials
            WHERE status = 'available'
            GROUP BY type
        `);
        const byType = byTypeResult.rows;

        // Get materials by quality
        const byQualityResult = await req.pool.query(`
            SELECT quality, COUNT(*) as count, SUM(quantity) as total_quantity
            FROM materials
            WHERE status = 'available'
            GROUP BY quality
        `);
        const byQuality = byQualityResult.rows;

        res.json({
            summary: stats,
            byType,
            byQuality
        });

    } catch (error) {
        console.error('Get materials stats error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Search materials
router.get('/search/:query', authenticateToken, async (req, res) => {
    try {
        const query = req.params.query;
        const searchResult = await req.pool.query(`
            SELECT m.*, w.name as warehouse_name
            FROM materials m
            LEFT JOIN warehouses w ON m.warehouse_id = w.id
            WHERE m.name ILIKE $1 OR m.type ILIKE $1 OR m.invoice_number ILIKE $1
            ORDER BY m.created_at DESC
            LIMIT 20
        `, [`%${query}%`]);

        res.json(searchResult.rows);

    } catch (error) {
        console.error('Search materials error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get low stock materials
router.get('/alerts/low-stock', authenticateToken, async (req, res) => {
    try {
        const threshold = req.query.threshold || 10;

        const lowStockResult = await req.pool.query(`
            SELECT m.*, w.name as warehouse_name
            FROM materials m
            LEFT JOIN warehouses w ON m.warehouse_id = w.id
            WHERE m.quantity <= $1 AND m.status = 'available'
            ORDER BY m.quantity ASC
        `, [threshold]);

        res.json(lowStockResult.rows);

    } catch (error) {
        console.error('Get low stock materials error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get expired materials
router.get('/alerts/expired', authenticateToken, async (req, res) => {
    try {
        const expiredResult = await req.pool.query(`
            SELECT m.*, w.name as warehouse_name
            FROM materials m
            LEFT JOIN warehouses w ON m.warehouse_id = w.id
            WHERE m.status = 'expired'
            ORDER BY m.updated_at DESC
        `);

        res.json(expiredResult.rows);

    } catch (error) {
        console.error('Get expired materials error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Bulk update materials
router.post('/bulk-update', authenticateToken, [
    body('material_ids').isArray().withMessage('يجب تحديد المواد'),
    body('updates').notEmpty().withMessage('يجب تحديد التحديثات')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { material_ids, updates } = req.body;

        // Build update query dynamically
        const updateFields = Object.keys(updates);
        const setClause = updateFields.map((field, index) => `${field} = $${index + 1}`).join(', ');
        const values = updateFields.map(field => updates[field]);

        // Update all selected materials
        for (const materialId of material_ids) {
            const query = `UPDATE materials SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length + 1}`;
            await req.pool.query(query, [...values, materialId]);
        }

        res.json({ message: 'تم تحديث المواد بنجاح' });

    } catch (error) {
        console.error('Bulk update materials error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get material usage history
router.get('/:id/usage-history', authenticateToken, async (req, res) => {
    try {
        const materialId = req.params.id;

        const usageResult = await req.pool.query(`
            SELECT
                oi.quantity as used_quantity,
                oi.total_price,
                o.order_number,
                o.customer_name,
                o.created_at as order_date,
                o.status as order_status
            FROM order_items oi
            LEFT JOIN orders o ON oi.order_id = o.id
            WHERE oi.material_id = $1
            ORDER BY o.created_at DESC
        `, [materialId]);

        res.json(usageResult.rows);

    } catch (error) {
        console.error('Get material usage history error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Reserve materials for order
router.post('/:id/reserve', authenticateToken, [
    body('quantity').isNumeric().withMessage('الكمية مطلوبة'),
    body('order_id').isNumeric().withMessage('رقم الطلب مطلوب')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const materialId = req.params.id;
        const { quantity, order_id } = req.body;

        // Check current quantity
        const materialResult = await req.pool.query('SELECT quantity, status FROM materials WHERE id = $1', [materialId]);
        const material = materialResult.rows[0];

        if (!material) {
            return res.status(404).json({ message: 'المادة غير موجودة' });
        }

        if (material.quantity < quantity) {
            return res.status(400).json({ message: 'الكمية غير كافية' });
        }

        // Update material status and quantity
        await req.pool.query('UPDATE materials SET quantity = quantity - $1, status = $2 WHERE id = $3',
            [quantity, 'reserved', materialId]);

        res.json({ message: 'تم حجز المواد بنجاح' });

    } catch (error) {
        console.error('Reserve materials error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Release reserved materials
router.post('/:id/release', authenticateToken, [
    body('quantity').isNumeric().withMessage('الكمية مطلوبة')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const materialId = req.params.id;
        const { quantity } = req.body;

        // Update material status and quantity
        await req.pool.query('UPDATE materials SET quantity = quantity + $1, status = $2 WHERE id = $3',
            [quantity, 'available', materialId]);

        res.json({ message: 'تم إلغاء حجز المواد بنجاح' });

    } catch (error) {
        console.error('Release materials error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get materials by warehouse
router.get('/warehouse/:warehouseId', authenticateToken, async (req, res) => {
    try {
        const warehouseId = req.params.warehouseId;

        const materialsResult = await req.pool.query(`
            SELECT m.*, w.name as warehouse_name
            FROM materials m
            LEFT JOIN warehouses w ON m.warehouse_id = w.id
            WHERE m.warehouse_id = $1
            ORDER BY m.created_at DESC
        `, [warehouseId]);

        res.json(materialsResult.rows);

    } catch (error) {
        console.error('Get materials by warehouse error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get material cost analysis
router.get('/:id/cost-analysis', authenticateToken, async (req, res) => {
    try {
        const materialId = req.params.id;

        const analysisResult = await req.pool.query(`
            SELECT
                m.name,
                m.cost as unit_cost,
                m.quantity as current_quantity,
                m.cost * m.quantity as total_value,
                AVG(oi.unit_price) as avg_selling_price,
                COUNT(oi.id) as times_used,
                SUM(oi.quantity) as total_sold_quantity,
                SUM(oi.total_price) as total_revenue
            FROM materials m
            LEFT JOIN order_items oi ON m.id = oi.material_id
            WHERE m.id = $1
            GROUP BY m.id, m.name, m.cost, m.quantity
        `, [materialId]);

        res.json(analysisResult.rows[0]);

    } catch (error) {
        console.error('Get material cost analysis error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

module.exports = router;