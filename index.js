require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(`${process.env.STRIPE_SECRET_KEY}`);
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;

const decoded = Buffer.from(`${process.env.FB_SERVICE_KEY}`, "base64").toString(
  "utf-8"
);

const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//? Generate Loan Tracking Id for Every Loan Unique Id
function generateLoanTrackingId() {
  const prefix = "LN"; // brand prefix
  const time = Date.now().toString(36); // compact timestamp
  const rand = Math.random().toString(36).slice(2, 8); // 6-chars random
  return `${prefix}-${time}-${rand.toUpperCase()}`;
}

//? ---- middlewares -------
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN_URL],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// JWT middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  // console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    // console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

const uri = process.env.URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.status(200).json({
    status: true,
    message: "LoanLink Server is Running Fine",
  });
});

async function run() {
  try {
    // await client.connect();

    //? Database and collection setup
    const db = client.db("loanLinkDB");
    const loansCollection = db.collection("loans");
    const usersCollection = db.collection("users");
    const loanApplicationCollection = db.collection("loanApplication");
    const paymentInfoCollection = db.collection("paymentInfo");

    //? Verify Admin Middleware with Database access to check admin activity
    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.tokenEmail;
        const user = await usersCollection.findOne({ email });
        if (!user || user?.role !== "admin") {
          return res.status(403).json({
            status: false,
            message: "Admin Actions Only",
            role: user?.role,
          });
        }
        next();
      } catch (error) {
        console.log(error.message);
      }
    };

    //? Verify Manager Middleware with Database access to check Manager activity
    const verifyManager = async (req, res, next) => {
      try {
        const email = req.tokenEmail;
        const user = await usersCollection.findOne({ email });
        if (!user || user?.role !== "manager") {
          return res.status(403).json({
            status: false,
            message: "Manager Actions Only",
            role: user?.role,
          });
        }
        next();
      } catch (error) {
        console.log(error.message);
      }
    };

    //? save users data in db
    app.post("/users", async (req, res) => {
      try {
        const userData = req.body;

        //? validate user email and name
        if (!userData?.email || !userData?.name) {
          return res.status(400).json({
            status: false,
            message: "User email and name is required",
          });
        }

        let allowedRoles = ["borrower", "manager"];
        let role = allowedRoles.includes(userData.role)
          ? userData.role
          : "borrower";

        userData.role = role;
        userData.created_At = new Date();
        userData.last_loggedIn = new Date();

        const query = { email: userData.email };
        const exitingUser = await usersCollection.findOne(query);

        //? validate the user is already stored in db or not
        if (exitingUser) {
          const update = {
            $set: {
              last_loggedIn: new Date(),
            },
          };
          const updateUser = await usersCollection.updateOne(query, update);
          return res.status(200).json({
            status: true,
            message: "User Already Exits and last loggedIn updated",
            updateUser,
          });
        }

        const result = await usersCollection.insertOne(userData);
        res.status(201).json({
          status: false,
          message: "All the users data save in db successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to post users data on db",
          error: error.message,
        });
      }
    });

    //? get the role of a user by users email
    app.get("/users/role", verifyJWT, async (req, res) => {
      try {
        const result = await usersCollection.findOne({ email: req.tokenEmail });
        res.status(200).json({
          status: true,
          message: "Get the users role by email successful",
          role: result?.role,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get users role by email",
          error: error.message,
        });
      }
    });

    //? available loans get api by show on home with limit
    app.get("/available-loans", async (req, res) => {
      try {
        const query = { show_on_home: true };
        const result = await loansCollection
          .find(query)
          .sort({ created_at: -1 })
          .limit(6)
          .toArray();
        res.status(200).json({
          status: true,
          message: "Available loans get api successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get api for available loans",
          error: error.message,
        });
      }
    });

    //? get api for all loans in the all loans page
    app.get("/all-loans", async (req, res) => {
      try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 10;

        const skip = (page - 1) * limit;

        const result = await loansCollection
          .find()
          .skip(skip)
          .limit(limit)
          .toArray();

        const total = await loansCollection.countDocuments();

        res.status(200).json({
          status: true,
          message: "Get all loans api successful",
          result,
          total,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get all the loans",
          error: error.message,
        });
      }
    });

    //? single get api by calling its id
    app.get("/all-loans/:id", verifyJWT, async (req, res) => {
      try {
        const loanId = req.params.id;

        if (!ObjectId.isValid(loanId)) {
          return res.status(400).json({
            status: false,
            message: "Invalid Object id",
          });
        }

        const query = { _id: new ObjectId(loanId) };
        const result = await loansCollection.findOne(query);

        if (!result) {
          return res.status(404).json({
            status: false,
            message: "Loan Not Found",
          });
        }

        res.status(200).json({
          status: true,
          message: "Single loan api data by id successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get single loan api data by id from db",
          error: error.message,
        });
      }
    });

    //? post api for add loan in loanCollection
    app.post("/add-loan", verifyJWT, verifyManager, async (req, res) => {
      try {
        const loanData = req.body;

        //? validate newLoans data if not found
        if (!loanData || Object.keys(loanData).length === 0) {
          return res.status(400).json({
            status: false,
            message: "Loans data required!!",
          });
        }

        //? convert max loan limit into Number for validation
        const maxLoanLimitNum = Number(loanData.max_loan_limit);

        //? validate number or negative
        if (isNaN(maxLoanLimitNum) || maxLoanLimitNum < 0) {
          return res.status(400).json({
            status: false,
            message: "Invalid Max Loan Limit",
          });
        }

        const newLoans = {
          loanId: generateLoanTrackingId(),
          loan_title: loanData.loan_title,
          image: loanData.image,
          description: loanData.description,
          category: loanData.category,
          interest_rate: loanData.interest_rate,
          max_loan_limit: maxLoanLimitNum,
          required_documents: loanData.required_documents,
          emi_plans: loanData.emi_plans,
          show_on_home: loanData.show_on_home,
          created_by: loanData.created_by,
          created_at: new Date(),
        };

        const result = await loansCollection.insertOne(newLoans);
        res.status(201).json({
          status: true,
          message: "Post api for loan data save successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to post api data loans",
          error: error.message,
        });
      }
    });

    //? post api for loan application to store in db
    app.post("/loan-application", async (req, res) => {
      try {
        const applicationData = req.body;

        //? validate the application data if not available
        if (!applicationData || Object.keys(applicationData).length === 0) {
          return res.status(400).json({
            status: false,
            message: "Loan Application Data Required",
          });
        }

        //? convert those into Number for validation
        const monthlyIncome = Number(applicationData.monthly_income);
        const loanAmount = Number(applicationData.loan_amount);

        //? validate number or negative
        if (
          isNaN(monthlyIncome) ||
          monthlyIncome < 0 ||
          isNaN(loanAmount) ||
          loanAmount < 0
        ) {
          return res.status(400).json({
            status: false,
            message: "Invalid Loan Amount or Monthly Income",
          });
        }

        applicationData.monthly_income = monthlyIncome;
        applicationData.loan_amount = loanAmount;
        applicationData.status = "pending";
        applicationData.application_fee_status = "unpaid";
        applicationData.created_at = new Date();

        const result = await loanApplicationCollection.insertOne(
          applicationData
        );

        res.status(201).json({
          status: true,
          message: "Post Loan Application Successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to post loan application",
          error: error.message,
        });
      }
    });

    //? Stripe Payment Related APis
    //? Post api for Stripe Create checkout session
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const paymentInfo = req.body;
        // console.log(paymentInfo)
        //? convert this Fixed value into US cents-->
        const amountToPay = 10 * 100;
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: paymentInfo?.loan_title,
                  description: paymentInfo?.category,
                },
                unit_amount: amountToPay,
              },
              quantity: 1,
            },
          ],
          customer_email: paymentInfo?.customer_email || undefined,
          mode: "payment",
          metadata: {
            loanId: paymentInfo?.loan_id || "",
            customer_name: paymentInfo?.customer_name || undefined,
            customer_email: paymentInfo?.customer_email || undefined,
          },
          success_url: `${process.env.CLIENT_DOMAIN_URL}/dashboard/my-loans/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_DOMAIN_URL}/dashboard/my-loans/payment-cancel`,
        });
        // console.log(session)
        // console.log(session.id)
        // console.log(session.payment_status)
        res.status(201).json({
          status: true,
          message: "Stripe payment checkout session created successful",
          url: session.url,
          id: session.id,
        });
      } catch (error) {
        console.log(error.message);
        res.status(500).json({
          status: false,
          message: "Failed to Create Stripe Payment checkout sessions",
          error: error.message,
        });
      }
    });

    //? Session id api create endpoint
    app.post("/payment-success", async (req, res) => {
      try {
        const sessionId = req.body.sessionId;
        // console.log(sessionId);

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        console.log("session retrieve-->", session);
        //? getting single plant data from db
        const loan = await loanApplicationCollection.findOne({
          _id: new ObjectId(session?.metadata?.loanId),
        });

        //? validate plant data from db
        if (!loan) {
          return res.status(404).json({
            status: false,
            message: "Loan not found",
          });
        }

        const payment = await paymentInfoCollection.findOne({
          transactionId: session?.payment_intent,
        });

        if (!payment) {
          if (session?.payment_status !== "paid") {
            return res.status(400).json({
              status: false,
              message: "Payment Not Complete",
            });
          } else {
            const paymentInfo = {
              loanId: session?.metadata?.loanId,
              transactionId: session?.payment_intent,
              customer_email: session?.customer_email,
              payment_status: session?.payment_status,
              loan_title: loan?.loan_title,
              category: loan?.category,
              quantity: 1,
              price: session?.amount_total / 100,
            };
            console.log(paymentInfo);
            const result = await paymentInfoCollection.insertOne(paymentInfo);

            //? update application Fee Status
            await loanApplicationCollection.updateOne(
              {
                _id: new ObjectId(session?.metadata?.loanId),
              },
              {
                $set: {
                  application_fee_status: session?.payment_status,
                  transactionId: session?.payment_intent,
                  paid_at: new Date(),
                },
              }
            );

            res.status(201).json({
              status: true,
              message: "Payment Info created Successfully",
              result,
              loan,
            });
          }
        } else {
          return res.status(409).json({
            status: false,
            message: "Payment Info already exists",
          });
        }
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to create payment success api data",
          error: error.message,
        });
      }
    });

    //? get api for getting all my loan application by email
    app.get("/my-loans", verifyJWT, async (req, res) => {
      try {
        const query = { borrower_email: req.tokenEmail };
        const result = await loanApplicationCollection
          .find(query)
          .sort({ approved_at: -1 })
          .toArray();
        res.status(200).json({
          status: true,
          message: "Get all my loan application by email successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get all my loan application by email",
          error: error.message,
        });
      }
    });

    //? get all the loans added by manager by manager email
    app.get("/manage-loans", verifyJWT, verifyManager, async (req, res) => {
      try {
        const query = { created_by: req.tokenEmail };

        const search = req.query.search;
        if (search) {
          query.category = { $regex: search, $options: "i" };
        }

        const result = await loansCollection
          .find(query)
          .sort({ created_at: -1 })
          .toArray();

        res.status(200).json({
          status: true,
          message: "Get all the loans by manager email successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get all the loans by manager email",
          error: error.message,
        });
      }
    });

    //? get api for single loan to show prefilled update form
    app.get("/manage-loans/:id", verifyJWT, verifyManager, async (req, res) => {
      try {
        const loan_id = req.params.id;
        const query = { _id: new ObjectId(loan_id) };
        const loan = await loansCollection.findOne(query);

        //? validate result
        if (!loan) {
          return res.status(404).json({
            status: false,
            message: "Loan not found",
          });
        }
        res.status(200).json({
          status: true,
          message: "Get api for single data successful",
          loan,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get single loan data",
          error: error.message,
        });
      }
    });

    //? patch api for single loan to update the loan from update form page
    app.patch("/manage-loans/update-loan/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };
        const updatedData = req.body;

        const existingLoan = await loansCollection.findOne(query);

        if (!existingLoan) {
          return res.status(404).json({
            status: false,
            message: "Loan not found",
          });
        }

        const updateDoc = {
          $set: {
            loan_title: updatedData.loan_title,
            category: updatedData.category,
            description: updatedData.description,
            interest_rate: updatedData.interest_rate,
            max_loan_limit: Number(updatedData.max_loan_limit),
            required_documents: updatedData.required_documents,
            emi_plans: updatedData.emi_plans,
            show_on_home: !!updatedData.show_on_home,
            image: updatedData.image,
            updated_at: new Date(),
          },
        };

        const updateResult = await loansCollection.updateOne(query, updateDoc);

        res.status(200).json({
          status: true,
          message: "Loan updated successfully",
          updateResult,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to update loan",
          error: error.message,
        });
      }
    });

    //? Delete api for single loan to delete the loan in manage loans page
    app.delete("/manage-loans/deleted/:id", verifyJWT, async (req, res) => {
      try {
        const loan_id = req.params.id;
        //? validate loan id is valid or not
        if (!ObjectId.isValid(loan_id)) {
          return res.status(400).json({
            status: false,
            message: "Invalid loan id",
          });
        }
        const query = { _id: new ObjectId(loan_id) };
        const result = await loansCollection.deleteOne(query);
        res.status(200).json({
          status: true,
          message: "Deleted single loan successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to delete single loan",
          error: error.message,
        });
      }
    });

    //? get single api to show loan details from loan application in my loans page
    // app.get("/my-loans/view/:id", verifyJWT, async (req, res) => {
    //   try {
    //     const loanId = req.params.id;

    //     //? validate id is available or not
    //     if (!loanId || typeof loanId !== "string") {
    //       return res.status(400).json({
    //         status: false,
    //         message: "Invalid loan id",
    //       });
    //     }
    //     const query = {loanId}
    //     const result = await loansCollection.findOne(query)

    //     //? validate result is available or not
    //     if(!result) {
    //       return res.status(404).json({
    //         status: false,
    //         message: 'Loan not found',
    //       })
    //     }

    //     res.status(200).json({
    //       status: true,
    //       message: "Get Single Loan by id successful in my loans page",
    //       result,
    //     })
    //   } catch (error) {
    //     res.status(500).json({
    //       status: false,
    //       message: "Failed to get single api data to view loan details",
    //       error: error.message,
    //     });
    //   }
    // });

    //? delete single api for pending loan application in my loans page
    app.delete("/my-loans/canceled/:id", verifyJWT, async (req, res) => {
      try {
        const pendingLoanId = req.params.id;
        //? validate the loan application id
        if (!ObjectId.isValid(pendingLoanId)) {
          return res.status(400).json({
            status: false,
            message: "Invalid loan application id",
          });
        }
        const query = { _id: new ObjectId(pendingLoanId) };
        const result = await loanApplicationCollection.deleteOne(query);
        res.status(200).json({
          status: true,
          message: "Deleted single pending loan application successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to deleted single pending loan application",
          error: error.message,
        });
      }
    });

    //? get api for getting all the pending application form by status
    app.get(
      "/pending-application",
      verifyJWT,
      verifyManager,
      async (req, res) => {
        try {
          const query = { status: "pending" };
          const result = await loanApplicationCollection
            .find(query)
            .sort({ created_at: -1 })
            .toArray();
          res.status(200).json({
            status: true,
            message: "Get all the pending application by status is successful",
            result,
          });
        } catch (error) {
          res.status(500).json({
            status: false,
            message: "Failed to get all the pending application by status",
            error: error.message,
          });
        }
      }
    );

    //? patch single api for approved application in pending application page
    app.patch(
      "/pending-application/approved/:id",
      verifyJWT,
      verifyManager,
      async (req, res) => {
        try {
          const pendingLoanId = req.params.id;
          //? validate the loan application id
          if (!ObjectId.isValid(pendingLoanId)) {
            return res.status(400).json({
              status: false,
              message: "Invalid loan application id",
            });
          }
          const query = { _id: new ObjectId(pendingLoanId) };
          const update = {
            $set: {
              status: "approved",
              approved_at: new Date(),
            },
          };
          const result = await loanApplicationCollection.updateOne(
            query,
            update
          );
          res.status(200).json({
            status: true,
            message:
              "Patch single pending application data by status approved successful",
            result,
          });
        } catch (error) {
          res.status(500).json({
            status: false,
            message:
              "Failed to patch single pending application data by status approved",
            error: error.message,
          });
        }
      }
    );

    //? patch single api for rejected application in pending application page
    app.patch(
      "/pending-application/rejected/:id",
      verifyJWT,
      verifyManager,
      async (req, res) => {
        try {
          const pendingLoanId = req.params.id;
          //? validate the loan application id
          if (!ObjectId.isValid(pendingLoanId)) {
            return res.status(400).json({
              status: false,
              message: "Invalid loan application id",
            });
          }
          const query = { _id: new ObjectId(pendingLoanId) };
          const update = {
            $set: {
              status: "rejected",
            },
          };
          const result = await loanApplicationCollection.updateOne(
            query,
            update
          );
          res.status(200).json({
            status: true,
            message:
              "Patch single pending application data by status rejected successful",
            result,
          });
        } catch (error) {
          res.status(500).json({
            status: false,
            message:
              "Failed to patch single pending application data by status rejected",
            error: error.message,
          });
        }
      }
    );

    //? get api for getting all the approved application form by status
    app.get(
      "/approved-application",
      verifyJWT,
      verifyManager,
      async (req, res) => {
        try {
          const query = { status: "approved" };
          const result = await loanApplicationCollection
            .find(query)
            .sort({ approved_at: -1 })
            .toArray();
          res.status(200).json({
            status: true,
            message: "Get all the approved application by status is successful",
            result,
          });
        } catch (error) {
          res.status(500).json({
            status: false,
            message: "Failed to get all the approved application by status",
            error: error.message,
          });
        }
      }
    );

    //? Get all the users to show in manage users in admin panel
    app.get("/manage-users", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const adminEmail = req.tokenEmail;
        const query = { email: { $ne: adminEmail } };
        const users = await usersCollection.find(query).toArray();
        //? validate users is available or not
        if (users.length === 0) {
          return res.status(404).json({
            status: false,
            message: "Users data not found",
          });
        }
        res.status(200).json({
          status: true,
          message: "Get all the users successful",
          users,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get all the users",
          error: error.message,
        });
      }
    });

    //? patch api for update users role in manage users in admin panel
    app.patch(
      "/manage-users/update-role",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const roleData = req.body;
          const query = { email: roleData.email };
          const update = {
            $set: {
              role: roleData.role,
              suspend_reason: roleData.suspend_reason,
              suspend_feedback: roleData.suspend_feedback,
              updated_by: req.tokenEmail,
            },
          };
          const result = await usersCollection.updateOne(query, update);
          res.status(200).json({
            status: true,
            message: "Patch/update users role successful",
            result,
          });
        } catch (error) {
          res.status(500).json({
            status: false,
            message: "Failed to patch/update users role",
            error: error.message,
          });
        }
      }
    );

    //? Get api for get all the loans in all loans in admin panel
    app.get(
      "/manage-users/all-loan",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const result = await loansCollection
            .find()
            .sort({ created_at: -1 })
            .toArray();
          res.status(200).json({
            status: true,
            message: "Get all loan in admin panel Successful",
            result,
          });
        } catch (error) {
          res.status(500).json({
            status: false,
            message: "Failed to get all loan in admin panel",
            error: error.message,
          });
        }
      }
    );

    //? get api for single loan to show prefilled update form in Admin Panel
    app.get(
      "/manage-users/all-loan/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const loan_id = req.params.id;
          const query = { _id: new ObjectId(loan_id) };
          const loan = await loansCollection.findOne(query);

          //? validate result
          if (!loan) {
            return res.status(404).json({
              status: false,
              message: "Loan not found",
            });
          }
          res.status(200).json({
            status: true,
            message: "Get api for single data successful",
            loan,
          });
        } catch (error) {
          res.status(500).json({
            status: false,
            message: "Failed to get single loan data",
            error: error.message,
          });
        }
      }
    );

    //? get api for get all the loan application form in loan application in admin panel
    app.get(
      "/manage-users/all-loan-application",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const result = await loanApplicationCollection
            .find()
            .sort({ created_at: -1 })
            .toArray();
          res.status(200).json({
            status: true,
            message: "get all the loan application form successful",
            result,
          });
        } catch (error) {
          res.status(500).json({
            status: false,
            message: "Failed to get all the loan application form",
            error: error.message,
          });
        }
      }
    );

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`LoanLink Server is Running on Port: ${port}`);
});
