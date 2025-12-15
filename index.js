require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;

const decoded = Buffer.from(`${process.env.FB_SERVICE_KEY}`, "base64").toString(
  "utf-8"
);

const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//? middlewares
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
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
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
    message: "Microloan Server is Running Fine",
  });
});

async function run() {
  try {
    await client.connect();

    //? Database and collection setup
    const db = client.db("microloanDB");
    const loansCollection = db.collection("loans");
    const usersCollection = db.collection("users");
    const loanApplicationCollection = db.collection('loanApplication');

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

    //? available loans get api by show on home with limit
    app.get("/available-loans", async (req, res) => {
      try {
        const query = { show_on_home: true };
        const result = await loansCollection.find(query).limit(6).toArray();
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
        const result = await loansCollection.find().toArray();
        res.status(200).json({
          status: true,
          message: "Get all loans api successful",
          result,
        });
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get all the loans in all loans page",
          error: error.message,
        });
      }
    });

    //? single get api by calling its id
    app.get("/all-loans/:id", async (req, res) => {
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

    //? post api for loan application to store in db
    app.post('/loan-application', async(req,res) => {
      try {
        const applicationData = req.body;

        //? validate the application data if not available
        if(!applicationData || Object.keys(applicationData).length === 0) {
          return res.status(400).json({
            status: false,
            message: 'Loan Application Data Required',
          })
        }

        //? convert those into Number for validation
        const monthlyIncome = Number(applicationData.monthly_income); 
        const loanAmount = Number(applicationData.loan_amount); 

        //? validate number or negative
        if(isNaN(monthlyIncome) || monthlyIncome < 0 || isNaN(loanAmount) || loanAmount < 0) {
          return res.status(400).json({
            status: false,
            message: 'Invalid Loan Amount or Monthly Income',
          })
        }

        applicationData.monthly_income = monthlyIncome
        applicationData.loan_amount = loanAmount
        applicationData.status = 'pending'
        applicationData.application_fee_status = 'unpaid'
        applicationData.created_at = new Date();

        const result = await loanApplicationCollection.insertOne(applicationData)

        res.status(201).json({
          status: true,
          message: 'Post Loan Application Successful',
          result,
        })

      } catch (error) {
        res.status(500).json({
          status: false,
          message: 'Failed to post loan application',
          error: error.message,
        })
      }
    })

    //? get api for getting all my loan application by email
    app.get('/my-loans', verifyJWT, async(req, res) => {
      try {
        const query = {borrower_email : req.tokenEmail}
        const result = await loanApplicationCollection.find(query).toArray()
        res.status(200).json({
          status: true,
          message: 'Get all my loan application by email successful',
          result,
        })
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get all my loan application by email",
          error: error.message,
        })
      }
    })

    //? get api for getting all the pending application form by status
    app.get('/pending-application', verifyJWT, async(req,res) => {
      try {
        const query = {status: 'pending'}
        const result = await loanApplicationCollection.find(query).toArray()
        res.status(200).json({
          status: true,
          message: 'Get all the pending application by status is successful',
          result,
        })
      } catch (error) {
        res.status(500).json({
          status: false,
          message: 'Failed to get all the pending application by status',
          error: error.message,
        })
      }
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Microloan Server is Running on Port: ${port}`);
});
