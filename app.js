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
  const query = "SELECT * FROM mypage_userdata WHERE web_username = ?";
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
        const token = jwt.sign({ userid: user.id }, JWT_SECRET, {
          expiresIn: "1h",
        });
        res.cookie("token", token, { httpOnly: true });
        res.redirect("/mypage");
      }
    }
  });
});

app.get("/mypage", (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).send("Access denied");
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const userQuery = "SELECT * FROM mypage_userdata WHERE id = ?";
    const creditQuery = "SELECT credit FROM credit_userdata WHERE webname = ?";
    const historyQuery = `
        SELECT exchange_history.*, credit_userdata.webname AS recipient_name
        FROM exchange_history
        JOIN credit_userdata ON exchange_history.address_id = credit_userdata.id
        WHERE exchange_history.user_id = ?
        ORDER BY exchange_history.exchange_datetime DESC
    `;
    const leaderboardQuery = `
        SELECT mu.web_username, cu.credit
        FROM mypage_userdata mu
        JOIN credit_userdata cu ON mu.web_username = cu.webname
        ORDER BY cu.credit DESC
        LIMIT 10
    `;

    userDBConnection.query(userQuery, [decoded.userid], (err, userResults) => {
      if (err) {
        console.error("Error fetching user:", err);
        return res.status(500).send("Server error");
      }

      if (userResults.length === 0) {
        return res.status(404).send("User not found");
      }

      const user = userResults[0];
      const webUsername = user.web_username;

      userDBConnection.query(creditQuery, [webUsername], (err, creditResults) => {
        if (err) {
          console.error("Error fetching credit:", err);
          return res.status(500).send("Server error");
        }

        if (creditResults.length === 0) {
          return res.status(404).send("Credit information not found");
        }

        const userCredit = creditResults[0].credit;

        userDBConnection.query(historyQuery, [decoded.userid], (err, historyResults) => {
          if (err) {
            console.error("Error fetching history:", err);
            return res.status(500).send("Server error");
          }

          userDBConnection.query(leaderboardQuery, (err, leaderboardResults) => {
            if (err) {
              console.error("Error fetching leaderboard:", err);
              return res.status(500).send("Server error");
            }

            // デバッグ用のログ出力
            console.log("Leaderboard results:", leaderboardResults);

            res.render("mypage", {
              username: user.username,
              webUsername: user.web_username,
              credit: userCredit,
              history: historyResults,
              leaderboard: leaderboardResults // 長者番付データをテンプレートに渡す
            });
          });
        });
      });
    });
  } catch (err) {
    console.error("Error verifying token:", err);
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

    const creditQuery = "SELECT credit FROM credit_userdata WHERE webname = ?";
    const addressQuery =
      "SELECT credit_userdata.id AS recipient_id, credit_userdata.credit AS recipient_credit FROM credit_userdata WHERE credit_userdata.webname = ?";
    const webnameQuery = "SELECT web_username FROM mypage_userdata WHERE id = ?";
    const userId = decoded.userid;

    console.log("Executing webname query with id:", userId);

    // Get the webname for the user
    userDBConnection.query(webnameQuery, [userId], (err, userResults) => {
      if (err) {
        console.error("Error fetching web_username:", err);
        return res.status(500).send("Server error");
      }

      if (userResults.length === 0) {
        console.error("User not found for id:", userId);
        return res.status(404).send("User not found");
      }

      const webUsername = userResults[0].web_username;
      console.log("Webname found:", webUsername);

      //自分のMCIDから自分の資産額を取得
      userDBConnection.query(creditQuery, [webUsername], (err, creditResults) => {
        if (err) {
          console.error("Error fetching credit:", err);
          return res.status(500).send("Server error");
        }

        if (creditResults.length === 0) {
          console.error("Credit information not found for webUsername:", webUsername);
          return res.status(404).send("Credit information not found");
        }

        const beforeCredit = creditResults[0].credit;
        const afterCredit = beforeCredit - parseInt(amount, 10);

        if (afterCredit < 0) {
          return res.status(400).send("Insufficient credit");
        }

        //送金先のMCIDから送金先のidと資産額を取得
        userDBConnection.query(addressQuery, [address], (err, addressResults) => {
          if (err) {
            console.error("Error fetching address:", err);
            return res.status(500).send("Server error");
          }

          if (addressResults.length === 0) {
            return res.status(400).send("Recipient not found");
          }

          const addressId = addressResults[0].recipient_id; //user_id→recipient_idに
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
                      VALUES (?, ?, NOW(), ?, '入金', ?, ?)
                  `;
          const updateSenderCreditQuery = `
                      UPDATE credit_userdata SET credit = ? WHERE webname = ?
                  `;
          const updateRecipientCreditQuery = `
                      UPDATE credit_userdata SET credit = ? WHERE webname = ?
                  `;

          //exchange_historyテーブルに自分の送金前資産と送金後資産とidと送金額と送金先をinsert
          userDBConnection.query(
            insertSenderQuery,
            [beforeCredit, afterCredit, userId, amount, addressId],
            (err, insertSenderResults) => {
              if (err) {
                console.error("Error inserting sender exchange history:", err);
                return res.status(500).send("Server error");
              }

              //credit_userdataテーブルの自分の資産額を送金後資産に更新
              userDBConnection.query(
                updateSenderCreditQuery,
                [afterCredit, webUsername],
                (err, updateSenderResults) => {
                  if (err) {
                    console.error("Error updating sender credit:", err);
                    return res.status(500).send("Server error");
                  }

                  console.log("Sender credit updated:", updateSenderResults);

                  //credit_userdataテーブルの相手の資産額を送金後資産に更新
                  userDBConnection.query(
                    updateRecipientCreditQuery,
                    [updatedRecipientCredit, address],
                    (err, updateRecipientResults) => {
                      if (err) {
                        console.error("Error updating recipient credit:", err);
                        return res.status(500).send("Server error");
                      }

                      console.log("Recipient credit updated:", updateRecipientResults);

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
                            console.error("Error inserting recipient exchange history:", err);
                            return res.status(500).send("Server error");
                          }

                          console.log("Recipient exchange history inserted:", insertRecipientResults);

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
        });
      });
    });
  } catch (err) {
    console.error("Error verifying token:", err);
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
    
    // web_username を取得するためのクエリ
    const webnameQuery = "SELECT web_username FROM mypage_userdata WHERE id = ?";
    
    userDBConnection.query(webnameQuery, [decoded.userid], (err, userResults) => {
      if (err) {
        console.error("Error fetching web_username:", err);
        return res.status(500).send("Server error");
      }

      if (userResults.length === 0) {
        console.error("User not found for id:", decoded.userid);
        return res.status(404).send("User not found");
      }

      const webUsername = userResults[0].web_username;

      const query = "UPDATE mypage_userdata SET password = ? WHERE web_username = ?";
      userDBConnection.query(query, [hashedPassword, webUsername], (err, results) => {
        if (err) {
          console.error("Error updating user:", err);
          res.status(500).send("Server error");
        } else {
          res.redirect("/");
        }
      });
    });
  } catch (err) {
    res.status(400).send("Invalid token");
  }
});

// 新しい依頼を作成するエンドポイント
app.post("/create-request", (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).send("Access denied");
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const client_id = decoded.userid;  // トークンからユーザーIDを取得
    const { requestTitle, request, reward, deadline } = req.body;

    const insertQuery = `
      INSERT INTO request (title, description, client_id, rewards, deadline_time, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const status = 0;  // 依頼の初期ステータスを0とする（必要に応じて変更）

    userDBConnection.query(insertQuery, [requestTitle, request, client_id, reward, deadline, status], (err, result) => {
      if (err) {
        console.error("Error inserting request:", err);
        return res.status(500).send("Server error");
      }
      res.redirect("/mypage");
    });
  } catch (err) {
    console.error("Error verifying token:", err);
    res.status(400).send("Invalid token");
  }
});


app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

//長者番付のスクリプト(後でOptimasIntaractiveページに移設)
