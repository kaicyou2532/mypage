const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const cookieParser = require('cookie-parser');
const app = express();
const port = 3007;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const JWT_SECRET = 'your_secret_key';

// MariaDBの接続設定
const mainDBConnection = mysql.createConnection({
    host: '192.168.3.31',
    user: 'AP',
    password: '0000',
    database: 'Minecraft_Mysqlinventory',
    port: 3306
});

// const additionalDBConnection = mysql.createConnection({
//     host: '192.168.3.31',
//     user: 'AP',
//     password: '0000',
//     database: 'UserAdditionalData',
//     port: 3306
// });

const userDBConnection = mysql.createConnection({
    host: '192.168.3.31',
    user: 'AP',
    password: '0000',
    database: 'userdata',
    port: 3306
});

mainDBConnection.connect((err) => {
    if (err) {
        console.error('Error connecting to main MariaDB:', err.stack);
        return;
    }
    console.log('Connected to main MariaDB as id ' + mainDBConnection.threadId);
});

// additionalDBConnection.connect((err) => {
//     if (err) {
//         console.error('Error connecting to additional MariaDB:', err.stack);
//         return;
//     }
//     console.log('Connected to additional MariaDB as id ' + additionalDBConnection.threadId);
// });

userDBConnection.connect((err) => {
    if (err) {
        console.error('Error connecting to additional MariaDB:', err.stack);
        return;
    }
    console.log('Connected to additional MariaDB as id ' + userDBConnection.threadId);
});


// ルートの設定
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const query = 'SELECT * FROM mypage_userdata WHERE username = ?';
    userDBConnection.query(query, [username], async (err, results) => {
        if (err) {
            console.error('Error fetching user:', err);
            res.status(500).send('Server error');
        } else if (results.length === 0) {
            res.status(400).send('User not found');
        } else {
            const user = results[0];
            const isValidPassword = await bcrypt.compare(password, user.password);
            if (!isValidPassword) {
                res.status(400).send('Invalid password');
            } else {
                const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '1h' });
                res.cookie('token', token, { httpOnly: true });
                res.redirect('/mypage');
            }
        }
    });
});

app.get('/mypage', (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).send('Access denied');
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userQuery = 'SELECT * FROM mypage_userdata WHERE username = ?';
        const creditQuery = 'SELECT credit FROM credit_userdata WHERE mcname = ?';
        const historyQuery = 'SELECT * FROM exchange_history WHERE user_id = ? ORDER BY exchange_datetime DESC';

        userDBConnection.query(userQuery, [decoded.username], (err, userResults) => {
            if (err) {
                console.error('Error fetching user:', err);
                return res.status(500).send('Server error');
            }

            const user = userResults[0];
            const userId = user.id;

            userDBConnection.query(creditQuery, [decoded.username], (err, creditResults) => {
                if (err) {
                    console.error('Error fetching credit:', err);
                    return res.status(500).send('Server error');
                }

                const userCredit = creditResults[0].credit;

                userDBConnection.query(historyQuery, [userId], (err, historyResults) => {
                    if (err) {
                        console.error('Error fetching history:', err);
                        return res.status(500).send('Server error');
                    }

                    res.render('mypage', { 
                        username: user.username, 
                        webUsername: user.web_username, 
                        credit: userCredit,
                        history: historyResults
                    });
                });
            });
        });
    } catch (err) {
        res.status(400).send('Invalid token');
    }
});



app.post('/exchange', (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).send('Access denied');
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { address, amount } = req.body;

        if (!address || !amount) {
            return res.status(400).send('Missing address or amount');
        }

        const userQuery = 'SELECT id FROM mypage_userdata WHERE username = ?';
        const creditQuery = 'SELECT credit FROM credit_userdata WHERE mcname = ?';
        const addressQuery = 'SELECT mypage_userdata.id AS user_id, credit_userdata.credit AS recipient_credit FROM mypage_userdata JOIN credit_userdata ON mypage_userdata.username = credit_userdata.mcname WHERE mypage_userdata.username = ?';

        userDBConnection.query(userQuery, [decoded.username], (err, userResults) => {
            if (err) {
                console.error('Error fetching user:', err);
                return res.status(500).send('Server error');
            }

            const userId = userResults[0].id;

            userDBConnection.query(creditQuery, [decoded.username], (err, creditResults) => {
                if (err) {
                    console.error('Error fetching credit:', err);
                    return res.status(500).send('Server error');
                }

                const beforeCredit = creditResults[0].credit;
                const afterCredit = beforeCredit - parseInt(amount, 10);

                if (afterCredit < 0) {
                    return res.status(400).send('Insufficient credit');
                }

                userDBConnection.query(addressQuery, [address], (err, addressResults) => {
                    if (err) {
                        console.error('Error fetching address:', err);
                        return res.status(500).send('Server error');
                    }

                    if (addressResults.length === 0) {
                        return res.status(400).send('Recipient not found');
                    }

                    const addressId = addressResults[0].user_id;
                    const recipientCredit = addressResults[0].recipient_credit;
                    const updatedRecipientCredit = recipientCredit + parseInt(amount, 10);

                    const insertSenderQuery = `
                        INSERT INTO exchange_history 
                        (before_credit, after_credit, exchange_datetime, user_id, which, amount, address_id) 
                        VALUES (?, ?, NOW(), ?, '送金', ?, ?)
                    `;
                    const insertRecipientQuery = `
                        INSERT INTO exchange_history 
                        (before_credit, after_credit, exchange_datetime, user_id, which, amount, address_id) 
                        VALUES (?, ?, NOW(), ?, '受信', ?, ?)
                    `;
                    const updateSenderCreditQuery = `
                        UPDATE credit_userdata SET credit = ? WHERE mcname = ?
                    `;
                    const updateRecipientCreditQuery = `
                        UPDATE credit_userdata SET credit = ? WHERE mcname = ?
                    `;

                    userDBConnection.query(insertSenderQuery, [beforeCredit, afterCredit, userId, amount, addressId], (err, insertSenderResults) => {
                        if (err) {
                            console.error('Error inserting sender exchange history:', err);
                            return res.status(500).send('Server error');
                        }

                        userDBConnection.query(updateSenderCreditQuery, [afterCredit, decoded.username], (err, updateSenderResults) => {
                            if (err) {
                                console.error('Error updating sender credit:', err);
                                return res.status(500).send('Server error');
                            }

                            console.log('Sender credit updated:', updateSenderResults);

                            userDBConnection.query(updateRecipientCreditQuery, [updatedRecipientCredit, address], (err, updateRecipientResults) => {
                                if (err) {
                                    console.error('Error updating recipient credit:', err);
                                    return res.status(500).send('Server error');
                                }

                                console.log('Recipient credit updated:', updateRecipientResults);

                                userDBConnection.query(insertRecipientQuery, [recipientCredit, updatedRecipientCredit, addressId, amount, userId], (err, insertRecipientResults) => {
                                    if (err) {
                                        console.error('Error inserting recipient exchange history:', err);
                                        return res.status(500).send('Server error');
                                    }

                                    console.log('Recipient exchange history inserted:', insertRecipientResults);

                                    res.send('Exchange recorded successfully');
                                });
                            });
                        });
                    });
                });
            });
        });
    } catch (err) {
        res.status(400).send('Invalid token');
    }
});









//パスワード変更手続き
app.post('/mypage', (req, res) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).send('Access denied');
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { newPassword } = req.body;
        const hashedPassword = bcrypt.hashSync(newPassword, 10);
        const query = 'UPDATE users SET password = ? WHERE username = ?';
        additionalDBConnection.query(query, [hashedPassword, decoded.username], (err, results) => {
            if (err) {
                console.error('Error updating user:', err);
                res.status(500).send('Server error');
            } else {
                res.send('Password updated successfully');
            }
        });
    } catch (err) {
        res.status(400).send('Invalid token');
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

