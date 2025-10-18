const bcrypt = require('bcryptjs');

// Generate hashed password
async function generateHash(password) {
    try {
        const hash = await bcrypt.hash(password, 10);
        console.log(`Password: ${password}`);
        console.log(`Hashed: ${hash}`);
    } catch (error) {
        console.error('Error generating hash:', error);
    }
}

// Default password is 'admin123'
generateHash('admin123').catch(console.error);