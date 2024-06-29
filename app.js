const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const cookieParser = require("cookie-parser");
const app = express();
const port = 3007;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const JWT_SECRET = "your_secret_key";

// MariaDBの接続設定
const mainDBConnection = mysql.createConnection({
  host: "192.168.3.31",
  user: "AP",
  password: "0000",
  database: "Minecraft_Mysqlinventory",
  port: 3306,
});

// const additionalDBConnection = mysql.createConnection({
//     host: '192.168.3.31',
//     user: 'AP',
//     password: '0000',
//     database: 'UserAdditionalData',
//     port: 3306
// });

const userDBConnection = mysql.createConnection({
  host: "192.168.3.31",
  user: "AP",
  password: "0000",
  database: "userdata",
  port: 3306,
});

mainDBConnection.connect((err) => {
  if (err) {
    console.error("Error connecting to main MariaDB:", err.stack);
    return;
  }
  console.log("Connected to main MariaDB as id " + mainDBConnection.threadId);
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
    console.error("Error connecting to additional MariaDB:", err.stack);
    return;
  }
  console.log(
    "Connected to additional MariaDB as id " + userDBConnection.threadId
  );
});

// ルートの設定
app.get("/", (req, res) => {
  res.render("index");
});

app.get("/login", (req, res) => {
  res.render("login");
});

//ログイン認証
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const query = "SELECT * FROM mypage_userdata WHERE username = ?";
  userDBConnection.query(query, [username], async (err, results) => {
    if (err) {
      console.error("Error fetching user:", err);
      res.status(500).send("Server error");
    } else if (results.length === 0) {
      res.status(400).send("User not found");
    } else {
      const user = results[0];
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        res.status(400).send("Invalid password");
      } else {
        const token = jwt.sign({ username: user.username }, JWT_SECRET, {
          expiresIn: "1h",
        });
        res.cookie("token", token, { httpOnly: true });
        res.redirect("/mypage");
      }
    }
  });
});

//マイページに表示する情報の取得
app.get("/mypage", (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).send("Access denied");
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userQuery = "SELECT * FROM mypage_userdata WHERE username = ?";
    const creditQuery = "SELECT credit FROM credit_userdata WHERE mcname = ?";
    const historyQuery = `
            SELECT exchange_history.*, credit_userdata.mcname AS recipient_name
            FROM exchange_history
            JOIN credit_userdata ON exchange_history.address_id = credit_userdata.id
            WHERE exchange_history.user_id = ?
            ORDER BY exchange_history.exchange_datetime DESC
        `;
    //自分のMCIDから自分のidを取得
    userDBConnection.query(
      userQuery,
      [decoded.username],
      (err, userResults) => {
        if (err) {
          console.error("Error fetching user:", err);
          return res.status(500).send("Server error");
        }

        const user = userResults[0];
        const userId = user.id;
        //自分のMCIDから自分の資産額を取得(上とまとめてidと同時取得にしたい(credit_userdataテーブルから))
        userDBConnection.query(
          creditQuery,
          [decoded.username],
          (err, creditResults) => {
            if (err) {
              console.error("Error fetching credit:", err);
              return res.status(500).send("Server error");
            }

            const userCredit = creditResults[0].credit;
            //自分のidから自分の取引履歴を取得
            userDBConnection.query(
              historyQuery,
              [userId],
              (err, historyResults) => {
                if (err) {
                  console.error("Error fetching history:", err);
                  return res.status(500).send("Server error");
                }

                res.render("mypage", {
                  username: user.username,
                  webUsername: user.web_username,
                  credit: userCredit,
                  history: historyResults,
                });
              }
            );
          }
        );
      }
    );
  } catch (err) {
    res.status(400).send("Invalid token");
  }
});

//送金機能
app.post("/exchange", (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).send("Access denied");
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { address, amount } = req.body;

    if (!address || !amount) {
      return res.status(400).send("Missing address or amount");
    }

    const userQuery = "SELECT id FROM mypage_userdata WHERE username = ?";
    const creditQuery = "SELECT credit FROM credit_userdata WHERE mcname = ?";
    const addressQuery =
      "SELECT credit_userdata.id AS recipient_id, credit_userdata.credit AS recipient_credit FROM credit_userdata WHERE credit_userdata.mcname = ?";
    //自分のMCIDから自分のidを取得
    userDBConnection.query(
      userQuery,
      [decoded.username],
      (err, userResults) => {
        if (err) {
          console.error("Error fetching user:", err);
          return res.status(500).send("Server error");
        }

        const userId = userResults[0].id;
        //自分のMCIDから自分の資産額を取得(自分のidから取得に変えたい)
        userDBConnection.query(
          creditQuery,
          [decoded.username],
          (err, creditResults) => {
            if (err) {
              console.error("Error fetching credit:", err);
              return res.status(500).send("Server error");
            }

            const beforeCredit = creditResults[0].credit;
            const afterCredit = beforeCredit - parseInt(amount, 10);

            if (afterCredit < 0) {
              return res.status(400).send("Insufficient credit");
            }
            //送金先のMCIDから送金先のidと資産額を取得(credit_userdataからのみで取ってこれるので修正)
            userDBConnection.query(
              addressQuery,
              [address],
              (err, addressResults) => {
                if (err) {
                  console.error("Error fetching address:", err);
                  return res.status(500).send("Server error");
                }

                if (addressResults.length === 0) {
                  return res.status(400).send("Recipient not found");
                }

                const addressId = addressResults[0].recipient_id; //user_id→recipient_idに
                const recipientCredit = addressResults[0].recipient_credit;
                const updatedRecipientCredit =
                  recipientCredit + parseInt(amount, 10);
                const insertSenderQuery = `
                        INSERT INTO exchange_history 
                        (before_credit, after_credit, exchange_datetime, user_id, which, amount, address_id) 
                        VALUES (?, ?, NOW(), ?, '送金', ?, ?)
                    `;
                const insertRecipientQuery = `
                        INSERT INTO exchange_history 
                        (before_credit, after_credit, exchange_datetime, user_id, which, amount, address_id) 
                        VALUES (?, ?, NOW(), ?, '入金', ?, ?)
                    `;
                const updateSenderCreditQuery = `
                        UPDATE credit_userdata SET credit = ? WHERE mcname = ?
                    `;
                const updateRecipientCreditQuery = `
                        UPDATE credit_userdata SET credit = ? WHERE mcname = ?
                    `;
                //exchange_historyテーブルに自分の送金前資産と送金後資産とidと送金額と送金先をinsert
                userDBConnection.query(
                  insertSenderQuery,
                  [beforeCredit, afterCredit, userId, amount, addressId],
                  (err, insertSenderResults) => {
                    if (err) {
                      console.error(
                        "Error inserting sender exchange history:",
                        err
                      );
                      return res.status(500).send("Server error");
                    }
                    //credit_userdataテーブルの自分の資産額を送金後資産に更新
                    userDBConnection.query(
                      updateSenderCreditQuery,
                      [afterCredit, decoded.username],
                      (err, updateSenderResults) => {
                        if (err) {
                          console.error("Error updating sender credit:", err);
                          return res.status(500).send("Server error");
                        }

                        console.log(
                          "Sender credit updated:",
                          updateSenderResults
                        );
                        //credit_userdataテーブルの相手の資産額を送金後資産に更新
                        userDBConnection.query(
                          updateRecipientCreditQuery,
                          [updatedRecipientCredit, address],
                          (err, updateRecipientResults) => {
                            if (err) {
                              console.error(
                                "Error updating recipient credit:",
                                err
                              );
                              return res.status(500).send("Server error");
                            }

                            console.log(
                              "Recipient credit updated:",
                              updateRecipientResults
                            );
                            //exchange_historyテーブルに相手の送金前資産と送金後資産とidと送金額と送金先をinsert
                            userDBConnection.query(
                              insertRecipientQuery,
                              [
                                recipientCredit,
                                updatedRecipientCredit,
                                addressId,
                                amount,
                                userId,
                              ],
                              (err, insertRecipientResults) => {
                                if (err) {
                                  console.error(
                                    "Error inserting recipient exchange history:",
                                    err
                                  );
                                  return res.status(500).send("Server error");
                                }

                                console.log(
                                  "Recipient exchange history inserted:",
                                  insertRecipientResults
                                );

                                // res.send("Exchange recorded successfully");
                                // 送金成功後にmypage.ejsにリダイレクトする
                                res.redirect("/mypage");
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  } catch (err) {
    res.status(400).send("Invalid token");
  }
});

//パスワード変更手続き
app.post("/mypage", (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).send("Access denied");
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { newPassword } = req.body;
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    const query = "UPDATE mypage_userdata SET password = ? WHERE username = ?";
    userDBConnection.query(
      query,
      [hashedPassword, decoded.username],
      (err, results) => {
        if (err) {
          console.error("Error updating user:", err);
          res.status(500).send("Server error");
        } else {
          // res.send("Password updated successfully");
          res.redirect("/");
        }
      }
    );
  } catch (err) {
    res.status(400).send("Invalid token");
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});


//長者番付のスクリプト(後でOptimasIntaractiveページに移設)
