const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

// Dynamic import for sqlite3 to handle cases where it's not installed
let sqlite3;
try {
    sqlite3 = require('sqlite3').verbose();
} catch (error) {
    console.log('SQLite3 module not found. Please install it with: npm install sqlite3');
    process.exit(1);
}

// SQLite connection
const sqliteDbPath = path.join(__dirname, 'database.sqlite');
const sqliteDb = new sqlite3.Database(sqliteDbPath);

// PostgreSQL connection
const pgPool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true'
});

async function migrateData() {
    try {
        console.log('Starting data migration from SQLite to PostgreSQL...');

        // Migrate users
        await migrateUsers();

        // Migrate warehouses
        await migrateWarehouses();

        // Migrate materials
        await migrateMaterials();

        // Migrate orders
        await migrateOrders();

        // Migrate order items
        await migrateOrderItems();

        // Migrate invoices
        await migrateInvoices();

        // Migrate stock movements
        await migrateStockMovements();

        console.log('Migration completed successfully!');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        // Close connections
        sqliteDb.close();
        await pgPool.end();
    }
}

async function migrateUsers() {
    console.log('Migrating users...');

    return new Promise((resolve, reject) => {
        sqliteDb.all('SELECT * FROM users', async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            for (const row of rows) {
                try {
                    await pgPool.query(`
                        INSERT INTO users (id, username, password, name, email, phone, user_type, is_active, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                        ON CONFLICT (id) DO NOTHING
                    `, [
                        row.id, row.username, row.password, row.name, row.email,
                        row.phone, row.user_type, row.is_active === 1,
                        row.created_at, row.updated_at
                    ]);
                } catch (error) {
                    console.error('Error migrating user:', row.id, error);
                }
            }

            console.log(`Migrated ${rows.length} users`);
            resolve();
        });
    });
}

async function migrateWarehouses() {
    console.log('Migrating warehouses...');

    return new Promise((resolve, reject) => {
        sqliteDb.all('SELECT * FROM warehouses', async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            for (const row of rows) {
                try {
                    await pgPool.query(`
                        INSERT INTO warehouses (id, name, type, capacity, location, manager_id, is_active, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        ON CONFLICT (id) DO NOTHING
                    `, [
                        row.id, row.name, row.type, row.capacity, row.location,
                        row.manager_id, row.is_active === 1, row.created_at, row.updated_at
                    ]);
                } catch (error) {
                    console.error('Error migrating warehouse:', row.id, error);
                }
            }

            console.log(`Migrated ${rows.length} warehouses`);
            resolve();
        });
    });
}

async function migrateMaterials() {
    console.log('Migrating materials...');

    return new Promise((resolve, reject) => {
        sqliteDb.all('SELECT * FROM materials', async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            for (const row of rows) {
                try {
                    await pgPool.query(`
                        INSERT INTO materials (id, name, weight, quantity, length, width, type, grammage,
                                             invoice_number, quality, roll_number, warehouse_id, source, cost, status, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                        ON CONFLICT (id) DO NOTHING
                    `, [
                        row.id, row.name, row.weight, row.quantity, row.length, row.width,
                        row.type, row.grammage, row.invoice_number, row.quality, row.roll_number,
                        row.warehouse_id, row.source, row.cost, row.status, row.created_at, row.updated_at
                    ]);
                } catch (error) {
                    console.error('Error migrating material:', row.id, error);
                }
            }

            console.log(`Migrated ${rows.length} materials`);
            resolve();
        });
    });
}

async function migrateOrders() {
    console.log('Migrating orders...');

    return new Promise((resolve, reject) => {
        sqliteDb.all('SELECT * FROM orders', async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            for (const row of rows) {
                try {
                    await pgPool.query(`
                        INSERT INTO orders (id, order_number, customer_name, customer_phone, customer_address,
                                          plate_count, notes, delivery_method, status, total_amount, cutting_fee,
                                          created_by, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                        ON CONFLICT (id) DO NOTHING
                    `, [
                        row.id, row.order_number, row.customer_name, row.customer_phone, row.customer_address,
                        row.plate_count, row.notes, row.delivery_method, row.status, row.total_amount,
                        row.cutting_fee, row.created_by, row.created_at, row.updated_at
                    ]);
                } catch (error) {
                    console.error('Error migrating order:', row.id, error);
                }
            }

            console.log(`Migrated ${rows.length} orders`);
            resolve();
        });
    });
}

async function migrateOrderItems() {
    console.log('Migrating order items...');

    return new Promise((resolve, reject) => {
        sqliteDb.all('SELECT * FROM order_items', async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            for (const row of rows) {
                try {
                    await pgPool.query(`
                        INSERT INTO order_items (id, order_id, material_id, quantity, weight, unit_price, total_price, notes)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        ON CONFLICT (id) DO NOTHING
                    `, [
                        row.id, row.order_id, row.material_id, row.quantity, row.weight,
                        row.unit_price, row.total_price, row.notes
                    ]);
                } catch (error) {
                    console.error('Error migrating order item:', row.id, error);
                }
            }

            console.log(`Migrated ${rows.length} order items`);
            resolve();
        });
    });
}

async function migrateInvoices() {
    console.log('Migrating invoices...');

    return new Promise((resolve, reject) => {
        sqliteDb.all('SELECT * FROM invoices', async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            for (const row of rows) {
                try {
                    await pgPool.query(`
                        INSERT INTO invoices (id, invoice_number, order_id, customer_name, customer_phone, customer_address,
                                            subtotal, cutting_fee, discount, tax, total_amount, status, created_by, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                        ON CONFLICT (id) DO NOTHING
                    `, [
                        row.id, row.invoice_number, row.order_id, row.customer_name, row.customer_phone, row.customer_address,
                        row.subtotal, row.cutting_fee, row.discount, row.tax, row.total_amount,
                        row.status, row.created_by, row.created_at, row.updated_at
                    ]);
                } catch (error) {
                    console.error('Error migrating invoice:', row.id, error);
                }
            }

            console.log(`Migrated ${rows.length} invoices`);
            resolve();
        });
    });
}

async function migrateStockMovements() {
    console.log('Migrating stock movements...');

    return new Promise((resolve, reject) => {
        sqliteDb.all('SELECT * FROM stock_movements', async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            for (const row of rows) {
                try {
                    await pgPool.query(`
                        INSERT INTO stock_movements (id, material_id, warehouse_id, movement_type, quantity, weight,
                                                    reference_id, reference_type, notes, created_by, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        ON CONFLICT (id) DO NOTHING
                    `, [
                        row.id, row.material_id, row.warehouse_id, row.movement_type, row.quantity, row.weight,
                        row.reference_id, row.reference_type, row.notes, row.created_by, row.created_at
                    ]);
                } catch (error) {
                    console.error('Error migrating stock movement:', row.id, error);
                }
            }

            console.log(`Migrated ${rows.length} stock movements`);
            resolve();
        });
    });
}

// Run migration
migrateData();