const express = require('express');
const cors = require('cors');
const port = process.env.PORT || 3000;
const app = express();

//? middlewares
app.use(express.json())
app.use(cors())

app.get('/', (req,res) => {
  res.status(200).json({
    status: true,
    message: "Microloan Server is Running Fine"
  })
})

app.listen(port, () => {
  console.log(`Microloan Server is Running on Port: ${port}`)
})