require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

//? middlewares
app.use(express.json());
app.use(cors());

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
    const usersCollection = db.collection('users')


    //? save users data in db
    app.post('/users', async(req,res) => {
      try {
        const userData = req.body

        //? validate user email and name
        if(!userData?.email || !userData?.name) {
          return res.status(400).json({
            status: false,
            message: "User email and name is required"
          })
        }

        let allowedRoles = ['borrower', 'manager']
        let role = allowedRoles.includes(userData.role) ? userData.role : 'borrower'
        
        userData.role = role;
        userData.created_At = new Date();
        userData.last_loggedIn = new Date();

        const query = {email: userData.email}
        const exitingUser = await usersCollection.findOne(query)
        
        //? validate the user is already stored in db or not
        if(exitingUser) {
          const update = {
            $set: {
              last_loggedIn: new Date(),
            }
          }
          const updateUser = await usersCollection.updateOne(query, update)
          return res.status(200).json({
            status: true,
            message: 'User Already Exits and last loggedIn updated',
            updateUser,
          })
        }

        const result = await usersCollection.insertOne(userData)
        res.status(201).json({
          status: false,
          message: "All the users data save in db successful",
          result,
        })

      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to post users data on db",
          error: error.message,
        })
      }
    })

    //? available loans get api by show on home with limit
    app.get("/available-loans", async (req, res) => {
      try {
        const query = { show_on_home: true };
        const result = await loansCollection.find(query).limit(6).toArray();
        res.status(200).json({
          status: true,
          message: "Available loans get api successful",
          result,
        })
      } catch (error) {
        res.status(500).json({
          status: false,
          message: 'Failed to get api for available loans',
          error: error.message,
        })
      }
    });

    //? get api for all loans in the all loans page
    app.get('/all-loans', async(req,res) => {
      try {
        const result = await loansCollection.find().toArray()
        res.status(200).json({
          status: true,
          message: 'Get all loans api successful',
          result,
        })
      } catch (error) {
        res.status(500).json({
          status: false,
          message: "Failed to get all the loans in all loans page",
          error: error.message,
        })
      }
    })

    //? single get api by calling its id
    app.get('/all-loans/:id', async(req,res) => {
      try {
        const loanId = req.params.id;

        if(!ObjectId.isValid(loanId)) {
          return res.status(400).json({
            status: false,
            message: "Invalid Object id",
          })
        }

        const query = {_id: new ObjectId(loanId)}
        const result = await loansCollection.findOne(query)

        if(!result) {
          return res.status(404).json({
            status: false,
            message: "Loan Not Found",
          })
        }

        res.status(200).json({
          status: true,
          message: "Single loan api data by id successful",
          result,
        })

      } catch (error) {
        res.status(500).json({
          status: false,
          message: 'Failed to get single loan api data by id from db',
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
