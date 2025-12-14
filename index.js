require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const { MongoClient, ServerApiVersion } = require("mongodb");
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
