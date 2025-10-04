const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const { authenticateToken } = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
            scriptSrcAttr: ["'unsafe-inline'"],
            fontSrc: ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "https://via.placeholder.com"],
            connectSrc: ["'self'"]
        }
    }
}));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '../')));

// Database connection
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true'
});

// Make pool accessible to routes (BEFORE importing routes)
app.use((req, res, next) => {
    req.pool = pool;
    next();
});

// Make createNotification function globally available
global.createNotification = createNotification;

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to PostgreSQL database:', err.message);
        console.log('Please make sure PostgreSQL is running and the database exists');
        process.exit(1);
    } else {
        console.log('Connected to PostgreSQL database');
        release();
        initializeDatabase();
    }
});

// Initialize database tables
async function initializeDatabase() {
    try {
        // Create tables in correct order (respecting foreign key constraints)
        const tables = [
            // Users table
            `CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(100),
                phone VARCHAR(20),
                user_type VARCHAR(50) NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,

            // Warehouses table
            `CREATE TABLE IF NOT EXISTS warehouses (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                type VARCHAR(50) NOT NULL,
                capacity DECIMAL(10,2),
                location TEXT,
                manager_id INTEGER,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (manager_id) REFERENCES users(id)
            )`,

            // Materials table
            `CREATE TABLE IF NOT EXISTS materials (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                weight DECIMAL(10,2),
                quantity INTEGER,
                length DECIMAL(10,2),
                width DECIMAL(10,2),
                type VARCHAR(50),
                grammage DECIMAL(10,2),
                invoice_number VARCHAR(50),
                quality VARCHAR(50),
                roll_number VARCHAR(50),
                warehouse_id INTEGER,
                source VARCHAR(100),
                cost DECIMAL(10,2),
                status VARCHAR(50) DEFAULT 'available',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
            )`,

            // Orders table
            `CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                order_number VARCHAR(50) UNIQUE NOT NULL,
                customer_name VARCHAR(200) NOT NULL,
                customer_phone VARCHAR(20),
                customer_address TEXT,
                plate_count INTEGER,
                notes TEXT,
                delivery_method VARCHAR(50),
                status VARCHAR(50) DEFAULT 'pending',
                total_amount DECIMAL(12,2),
                cutting_fee DECIMAL(10,2),
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )`,

            // Order items table
            `CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id INTEGER,
                material_id INTEGER,
                quantity INTEGER,
                weight DECIMAL(10,2),
                unit_price DECIMAL(10,2),
                total_price DECIMAL(10,2),
                notes TEXT,
                FOREIGN KEY (order_id) REFERENCES orders(id),
                FOREIGN KEY (material_id) REFERENCES materials(id)
            )`,

            // Invoices table
            `CREATE TABLE IF NOT EXISTS invoices (
                id SERIAL PRIMARY KEY,
                invoice_number VARCHAR(50) UNIQUE NOT NULL,
                order_id INTEGER,
                customer_name VARCHAR(200) NOT NULL,
                customer_phone VARCHAR(20),
                customer_address TEXT,
                subtotal DECIMAL(12,2),
                cutting_fee DECIMAL(10,2),
                discount DECIMAL(10,2),
                tax DECIMAL(10,2),
                total_amount DECIMAL(12,2),
                status VARCHAR(50) DEFAULT 'draft',
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(id),
                FOREIGN KEY (created_by) REFERENCES users(id)
            )`,

            // Stock movements table
            `CREATE TABLE IF NOT EXISTS stock_movements (
                id SERIAL PRIMARY KEY,
                material_id INTEGER,
                warehouse_id INTEGER,
                movement_type VARCHAR(50) NOT NULL,
                quantity INTEGER,
                weight DECIMAL(10,2),
                reference_id INTEGER,
                reference_type VARCHAR(50),
                notes TEXT,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (material_id) REFERENCES materials(id),
                FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
                FOREIGN KEY (created_by) REFERENCES users(id)
            )`,

            // Maintenance requests table
            `CREATE TABLE IF NOT EXISTS maintenance_requests (
                id SERIAL PRIMARY KEY,
                warehouse_id INTEGER,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                priority VARCHAR(20) DEFAULT 'medium',
                status VARCHAR(20) DEFAULT 'pending',
                requested_by INTEGER,
                assigned_to INTEGER,
                scheduled_date TIMESTAMP,
                completed_date TIMESTAMP,
                estimated_cost DECIMAL(10,2),
                actual_cost DECIMAL(10,2),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
                FOREIGN KEY (requested_by) REFERENCES users(id),
                FOREIGN KEY (assigned_to) REFERENCES users(id)
            )`,

            // Inventory counts table
            `CREATE TABLE IF NOT EXISTS inventory_counts (
                id SERIAL PRIMARY KEY,
                warehouse_id INTEGER,
                material_id INTEGER,
                counted_quantity INTEGER,
                system_quantity INTEGER,
                variance INTEGER,
                count_date TIMESTAMP DEFAULT CURRENT_DATE,
                counted_by INTEGER,
                status VARCHAR(20) DEFAULT 'pending',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
                FOREIGN KEY (material_id) REFERENCES materials(id),
                FOREIGN KEY (counted_by) REFERENCES users(id)
            )`,

            // Warehouse sensors table
            `CREATE TABLE IF NOT EXISTS warehouse_sensors (
                id SERIAL PRIMARY KEY,
                warehouse_id INTEGER,
                sensor_type VARCHAR(50) NOT NULL,
                sensor_name VARCHAR(100) NOT NULL,
                value DECIMAL(10,2),
                unit VARCHAR(20),
                status VARCHAR(20) DEFAULT 'active',
                last_reading TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                alert_threshold_min DECIMAL(10,2),
                alert_threshold_max DECIMAL(10,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
            )`,

            // Notifications table
            `CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                type VARCHAR(50) DEFAULT 'system',
                priority VARCHAR(20) DEFAULT 'medium',
                is_read BOOLEAN DEFAULT false,
                read_at TIMESTAMP,
                related_id INTEGER,
                related_type VARCHAR(50),
                data JSONB,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )`
        ];

        for (const tableSQL of tables) {
            await pool.query(tableSQL);
        }

        console.log('Database tables created successfully');

        // Insert demo data
        await insertDemoData();
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}
// Insert demo data
async function insertDemoData() {
    try {
        // Check if demo data already exists
        const userCount = await pool.query("SELECT COUNT(*) as count FROM users");

        if (parseInt(userCount.rows[0].count) === 0) {
            const bcrypt = require('bcryptjs');
            const demoUsers = [
                { username: 'admin', password: 'admin123', name: 'مدير النظام', user_type: 'admin' },
                { username: 'warehouse1', password: 'wh123', name: 'أمين المستودع 1', user_type: 'warehouse_manager' },
                { username: 'cutting1', password: 'cut123', name: 'مسؤول القص 1', user_type: 'cutting_manager' },
                { username: 'sorting1', password: 'sort123', name: 'مسؤول الفرازة 1', user_type: 'sorting_manager' },
                { username: 'accountant1', password: 'acc123', name: 'المحاسب 1', user_type: 'accountant' },
                { username: 'tracker1', password: 'track123', name: 'متابع الطلبات 1', user_type: 'order_tracker' },
                { username: 'delivery1', password: 'del123', name: 'مسؤول التسليم 1', user_type: 'delivery_manager' },
                { username: 'sales1', password: 'sales123', name: 'موظف المبيعات 1', user_type: 'sales' }
            ];

            // Insert demo users
            for (const user of demoUsers) {
                const hashedPassword = await bcrypt.hash(user.password, 10);
                await pool.query(
                    'INSERT INTO users (username, password, name, user_type) VALUES ($1, $2, $3, $4)',
                    [user.username, hashedPassword, user.name, user.user_type]
                );
            }

            // Insert demo warehouses
            const demoWarehouses = [
                { name: 'مستودع رئيسي 1', type: 'main', capacity: 500, location: 'المبنى الرئيسي - الطابق الأرضي' },
                { name: 'مستودع رئيسي 2', type: 'main', capacity: 400, location: 'المبنى الرئيسي - الطابق الأول' },
                { name: 'مستودع قصاصة 1', type: 'cutting', capacity: 200, location: 'قسم القص - الطابق الثاني' },
                { name: 'مستودع قصاصة 2', type: 'cutting', capacity: 150, location: 'قسم القص - الطابق الثالث' },
                { name: 'مستودع فرازة 1', type: 'sorting', capacity: 180, location: 'قسم الفرز - الطابق الرابع' },
                { name: 'مستودع فرازة 2', type: 'sorting', capacity: 120, location: 'قسم الفرز - الطابق الخامس' },
                { name: 'مستودع أمانات مفوترة', type: 'safekeeping', capacity: 100, location: 'قسم الأمانات - الطابق السفلي' },
                { name: 'مستودع أمانات فرز', type: 'safekeeping', capacity: 80, location: 'قسم الأمانات - الطابق السفلي' }
            ];

            for (const warehouse of demoWarehouses) {
                await pool.query(
                    'INSERT INTO warehouses (name, type, capacity, location) VALUES ($1, $2, $3, $4)',
                    [warehouse.name, warehouse.type, warehouse.capacity, warehouse.location]
                );
            }

            // Insert demo materials
            const demoMaterials = [
                { name: 'ورق أبيض A4', weight: 500, quantity: 100, length: 100, width: 70, type: 'ورق', grammage: 80, invoice_number: 'INV-001', quality: 'ممتاز', roll_number: 'R001', warehouse_id: 1, source: 'شركة الورق الحديثة', cost: 2500 },
                { name: 'ورق كرتون مموج', weight: 800, quantity: 50, length: 120, width: 80, type: 'كرتون', grammage: 200, invoice_number: 'INV-002', quality: 'جيد', roll_number: 'R002', warehouse_id: 1, source: 'مصنع الكرتون الأردني', cost: 3200 },
                { name: 'بلاستيك شفاف', weight: 200, quantity: 75, length: 150, width: 100, type: 'بلاستيك', grammage: 50, invoice_number: 'INV-003', quality: 'ممتاز', roll_number: 'R003', warehouse_id: 2, source: 'شركة البلاستيك المتقدمة', cost: 1800 },
                { name: 'ورق لامع ملون', weight: 300, quantity: 60, length: 90, width: 60, type: 'ورق', grammage: 120, invoice_number: 'INV-004', quality: 'ممتاز', roll_number: 'R004', warehouse_id: 1, source: 'شركة الطباعة الفاخرة', cost: 2100 }
            ];

            for (const material of demoMaterials) {
                await pool.query(`
                    INSERT INTO materials (name, weight, quantity, length, width, type, grammage,
                                         invoice_number, quality, roll_number, warehouse_id, source, cost)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                `, [
                    material.name, material.weight, material.quantity, material.length, material.width,
                    material.type, material.grammage, material.invoice_number, material.quality,
                    material.roll_number, material.warehouse_id, material.source, material.cost
                ]);
            }

            console.log('Demo data inserted successfully');
        }
    } catch (error) {
        console.error('Error inserting demo data:', error);
    }
}

// Routes
const authRoutes = require('./routes/auth');
const warehouseRoutes = require('./routes/warehouses');
const materialRoutes = require('./routes/materials');
const orderRoutes = require('./routes/orders');
const invoiceRoutes = require('./routes/invoices');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const permissionsRoutes = require('./routes/permissions');

app.use('/api/auth', authRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/permissions', permissionsRoutes);

// Additional API routes for advanced functionality
app.use('/api/search', require('./routes/search'));
app.use('/api/export', require('./routes/export'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/notifications', require('./routes/notifications'));

// Get user notifications endpoint
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 20, offset = 0, unread_only = false } = req.query;

        let query = `
            SELECT n.*, u.name as created_by_name
            FROM notifications n
            LEFT JOIN users u ON n.created_by = u.id
            WHERE n.user_id = $1
        `;
        const params = [userId];

        if (unread_only === 'true') {
            query += ' AND n.is_read = false';
        }

        query += ' ORDER BY n.created_at DESC LIMIT $2 OFFSET $3';
        params.push(parseInt(limit), parseInt(offset));

        const result = await req.pool.query(query, params);

        res.json({
            notifications: result.rows,
            total: result.rows.length,
            has_more: result.rows.length === parseInt(limit)
        });

    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Mark notification as read
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        const notificationId = req.params.id;
        const userId = req.user.id;

        const result = await req.pool.query(
            'UPDATE notifications SET is_read = true, read_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 RETURNING *',
            [notificationId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'التنبيه غير موجود' });
        }

        res.json({ notification: result.rows[0] });

    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get unread notifications count
app.get('/api/notifications/unread-count', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await req.pool.query(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false',
            [userId]
        );

        res.json({ count: parseInt(result.rows[0].count) });

    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// WebSocket connections for real-time notifications
const connectedUsers = new Map();

// Real-time notifications endpoint
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get recent notifications (stock movements, new orders, etc.)
        const notificationsResult = await req.pool.query(`
            SELECT
                sm.id,
                sm.movement_type,
                sm.quantity,
                sm.created_at,
                m.name as material_name,
                w.name as warehouse_name,
                u.name as user_name
            FROM stock_movements sm
            LEFT JOIN materials m ON sm.material_id = m.id
            LEFT JOIN warehouses w ON sm.warehouse_id = w.id
            LEFT JOIN users u ON sm.created_by = u.id
            ORDER BY sm.created_at DESC
            LIMIT 20
        `);

        const notifications = notificationsResult.rows.map(row => ({
            id: row.id,
            type: row.movement_type === 'in' ? 'إدخال مواد' : 'إخراج مواد',
            message: `${row.movement_type === 'in' ? 'تم إدخال' : 'تم إخراج'} ${row.quantity} من ${row.material_name}`,
            details: `المستودع: ${row.warehouse_name} | المستخدم: ${row.user_name}`,
            time: row.created_at,
            icon: row.movement_type === 'in' ? 'plus-circle' : 'minus-circle',
            color: row.movement_type === 'in' ? 'green' : 'orange'
        }));

        res.json(notifications);

    } catch (error) {
        console.error('Notifications error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Get system alerts
app.get('/api/alerts', authenticateToken, async (req, res) => {
    try {
        const alerts = [];

        // Check for low stock materials
        const lowStockResult = await req.pool.query(`
            SELECT name, quantity, warehouse_id
            FROM materials
            WHERE quantity < 10 AND status = 'available'
            ORDER BY quantity ASC
            LIMIT 5
        `);

        lowStockResult.rows.forEach(row => {
            alerts.push({
                type: 'warning',
                message: `تنبيه: كمية ${row.name} منخفضة (${row.quantity} وحدة)`,
                icon: 'exclamation-triangle',
                color: 'yellow'
            });
        });

        // Check for pending orders
        const pendingOrdersResult = await req.pool.query(`
            SELECT COUNT(*) as count FROM orders WHERE status = 'pending'
        `);

        if (parseInt(pendingOrdersResult.rows[0].count) > 0) {
            alerts.push({
                type: 'info',
                message: `يوجد ${pendingOrdersResult.rows[0].count} طلب قيد الانتظار`,
                icon: 'clock',
                color: 'blue'
            });
        }

        res.json(alerts);

    } catch (error) {
        console.error('Alerts error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Helper function to create notifications
async function createNotification(pool, userId, title, message, type, priority = 'medium', relatedId = null, relatedType = null, data = null) {
    try {
        await pool.query(
            `INSERT INTO notifications (user_id, title, message, type, priority, related_id, related_type, data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [userId, title, message, type, priority, relatedId, relatedType, JSON.stringify(data)]
        );
    } catch (error) {
        console.error('Error creating notification:', error);
    }
}

// Dashboard statistics endpoint
app.get('/api/reports/dashboard-stats', authenticateToken, async (req, res) => {
    try {
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

// Recent activities endpoint
app.get('/api/reports/recent-activities', authenticateToken, async (req, res) => {
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

// Advanced search endpoint
app.get('/api/search', authenticateToken, async (req, res) => {
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

// Export data endpoint
app.get('/api/export/:type', authenticateToken, async (req, res) => {
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

// System health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        // Check database connection
        const dbCheck = await req.pool.query('SELECT 1');

        // Check system resources (basic)
        const uptime = process.uptime();
        const memoryUsage = process.memoryUsage();

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: uptime,
            memory: {
                rss: memoryUsage.rss,
                heapTotal: memoryUsage.heapTotal,
                heapUsed: memoryUsage.heapUsed
            },
            database: 'connected'
        });

    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// Get system logs (admin only)
app.get('/api/logs', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه الوصول للسجلات' });
        }

        // This is a simplified version. In a real system, you'd read from log files
        const logs = [
            {
                timestamp: new Date().toISOString(),
                level: 'info',
                message: 'System started successfully',
                source: 'server'
            },
            {
                timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
                level: 'warning',
                message: 'High memory usage detected',
                source: 'monitor'
            }
        ];

        res.json(logs);

    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Backup database (admin only)
app.post('/api/backup', authenticateToken, async (req, res) => {
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

// Get system settings
app.get('/api/settings', authenticateToken, async (req, res) => {
    try {
        const settings = {
            system: {
                name: 'نظام إدارة المستودعات المتقدم',
                version: '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                port: process.env.PORT || 3000
            },
            features: {
                notifications: true,
                reports: true,
                export: true,
                backup: true,
                multi_warehouse: true,
                user_management: true
            },
            limits: {
                max_materials_per_warehouse: 10000,
                max_orders_per_day: 1000,
                max_users: 100,
                session_timeout: 7 * 24 * 60 * 60 * 1000 // 7 days
            }
        };

        res.json(settings);

    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Update system settings (admin only)
app.put('/api/settings', authenticateToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.userType !== 'admin') {
            return res.status(403).json({ message: 'فقط المدير يمكنه تحديث الإعدادات' });
        }

        const { settings } = req.body;

        // In a real system, you'd save these to a settings table or config file
        res.json({
            message: 'تم تحديث الإعدادات بنجاح',
            settings: settings
        });

    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Access the application at: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    try {
        await pool.end();
        console.log('Database connection pool closed');
        process.exit(0);
    } catch (error) {
        console.error('Error closing database pool:', error);
        process.exit(1);
    }
});

module.exports = app;