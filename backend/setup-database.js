const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: 'postgres', // Connect to default database first
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true'
});

async function setupDatabase() {
    try {
        console.log('Setting up PostgreSQL database...');

        // Drop database if exists and create new one
        try {
            await pool.query('DROP DATABASE IF EXISTS warehouse_management');
        } catch (error) {
            console.log('Database does not exist or cannot be dropped, continuing...');
        }
        await pool.query('CREATE DATABASE warehouse_management');

        // Close connection to default database
        await pool.end();

        // Connect to the new database
        const appPool = new Pool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            ssl: process.env.DB_SSL === 'true'
        });

        // Create tables
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
                approved_by INTEGER,
                approved_at TIMESTAMP,
                paid_at TIMESTAMP,
                delivered_at TIMESTAMP,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(id),
                FOREIGN KEY (created_by) REFERENCES users(id),
                FOREIGN KEY (approved_by) REFERENCES users(id)
            )`,

            // Invoice items table
            `CREATE TABLE IF NOT EXISTS invoice_items (
                id SERIAL PRIMARY KEY,
                invoice_id INTEGER,
                material_name VARCHAR(200) NOT NULL,
                description TEXT,
                quantity INTEGER NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                total_price DECIMAL(10,2) NOT NULL,
                material_id INTEGER,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
                FOREIGN KEY (material_id) REFERENCES materials(id)
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

            // Notifications table
            `CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER,
                title VARCHAR(200) NOT NULL,
                message TEXT,
                type VARCHAR(50) NOT NULL,
                priority VARCHAR(20) DEFAULT 'medium',
                is_read BOOLEAN DEFAULT false,
                read_at TIMESTAMP,
                related_id INTEGER,
                related_type VARCHAR(50),
                data JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
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
            )`
        ];

        for (const tableSQL of tables) {
            await appPool.query(tableSQL);
        }

        console.log('Database tables created successfully');

        // Insert demo data
        await insertDemoData(appPool);

        await appPool.end();
        console.log('Database setup completed successfully!');

    } catch (error) {
        console.error('Error setting up database:', error);
    }
}

async function insertDemoData(pool) {
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

            // Insert demo notifications
            const demoNotifications = [
                { user_id: 1, title: 'مرحباً بك في النظام', message: 'تم إعداد حسابك بنجاح. يمكنك الآن البدء في استخدام النظام', type: 'welcome', priority: 'medium' },
                { user_id: 1, title: 'تنبيه انخفاض المخزون', message: 'المادة "بلاستيك شفاف" وصلت إلى الحد الأدنى المسموح', type: 'low_stock', priority: 'high', related_id: 3, related_type: 'material' },
                { user_id: 1, title: 'طلب صيانة جديد', message: 'تم استلام طلب صيانة لمستودع رئيسي 1', type: 'maintenance', priority: 'medium', related_id: 1, related_type: 'warehouse' },
                { user_id: 1, title: 'طلبية جديدة', message: 'تم استلام طلبية جديدة رقم #ORD-001', type: 'new_order', priority: 'medium', related_id: 1, related_type: 'order' },
                { user_id: 1, title: 'تقرير يومي', message: 'تم إنشاء التقرير اليومي للمبيعات والمخزون', type: 'report', priority: 'low' }
            ];

            for (const notification of demoNotifications) {
                await pool.query(
                    'INSERT INTO notifications (user_id, title, message, type, priority, related_id, related_type) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                    [notification.user_id, notification.title, notification.message, notification.type, notification.priority, notification.related_id, notification.related_type]
                );
            }

            console.log('Demo notifications inserted successfully');
        }
    } catch (error) {
        console.error('Error inserting demo data:', error);
    }
}

// Run setup
setupDatabase();