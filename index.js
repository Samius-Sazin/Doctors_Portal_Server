//dot env
require('dotenv').config();

const express = require('express');
const app = express();
const port = process.env.PORT || 5000;

//Cors set up
const cors = require('cors');
app.use(cors());
app.use(express.json());

//parse files
const fileParser = require('express-fileupload');
app.use(fileParser());




//Service account setup/ JWT setup
const admin = require("firebase-admin");
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

//Varify Token
const varifyToken = async (req, res, next) => {
    if (req?.headers?.authorization.startsWith('Bearer ')) {
        const idToken = req?.headers?.authorization.split(' ')[1];

        try {
            const decodedUser = await admin.auth().verifyIdToken(idToken);
            req.decodedEmail = decodedUser.email;
        }
        catch {

        }
    }

    next();
}

//Stripe set up
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

//mongoDB part
const { MongoClient, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jmx7rsi.mongodb.net/`;
const client = new MongoClient(uri);

async function run() {
    try {
        // Connect to the Atlas cluster
        await client.connect();

        const database = client.db("doctors_portal");
        const usersCollection = database.collection("users");
        const appointmentsCollection = database.collection("appointments");
        const doctorsCollection = database.collection("doctors");

        //save appointments to DB from client site
        app.post('/appointments', async (req, res) => {
            //appointment that need to be insert
            const newAppointment = req.body;
            //Insert newAppointment into the appointments collection
            const result = await appointmentsCollection.insertOne(newAppointment);
            //sending the response
            res.send(result);
        })

        //get user data from client site/from registration page, and save them to DB
        app.post('/users', async (req, res) => {
            const userData = req.body;
            const result = await usersCollection.insertOne(userData);
            res.send(result);
        })

        app.put('/users', async (req, res) => {
            const userData = req.body;
            const filter = { email: userData.email };

            const options = { upsert: true };

            const updateUserData = {
                $set: {
                    displayName: userData.displayName,
                    email: userData.email,
                    phoneNumber: userData.phoneNumber,
                    photoURL: userData.photoURL,
                }
            };

            const result = await usersCollection.updateOne(filter, updateUserData, options);

            res.send(result);
        })

        //set admin role
        app.put('/users/admin', varifyToken, async (req, res) => {
            const emailFromToken = req?.decodedEmail;
            if (emailFromToken) {
                const query = { email: emailFromToken }
                const emailFromDatabase = await usersCollection.findOne(query);

                if (emailFromDatabase.role === 'admin') {
                    const email = req.body.email;
                    const filter = { email: email };
                    const options = { upsert: false };
                    const updateRole = {
                        $set: { role: 'admin' }
                    };
                    const result = await usersCollection.updateOne(filter, updateRole, options);
                    res.send(result);
                }
                else {
                    res.status(403).json({ message: 'You don\'t have permission.' });
                }
            }
            else {
                res.status(401).json({ message: "You are not authorized." })
            }
        })

        app.get('/users/:email', async (req, res) => {
            //get the email from req.params, that basically sent from client side
            const adminEmail = req.params.email;
            //make a query with this email that will used to search the user
            const query = { email: adminEmail };
            // get the user from DB by searching with the email set in the query
            const user = await usersCollection.findOne(query);
            //if user has role for admin then it can able to make changes in website, sent true value to client side
            let isAdmin = false;
            if (user?.role === 'admin') {
                isAdmin = true;
            }
            res.send({ isAdmin: isAdmin });
        })

        //get appointment searching by email & date from DB to client.
        app.get('/appointments', async (req, res) => {
            const patientEmail = req.query.patientEmail;
            const date = req.query.date;
            const query = { patientEmail: patientEmail, date: date };
            const cursor = appointmentsCollection.find(query);
            const appointments = await cursor.toArray();
            res.send(appointments);
        })

        //send files (information of doctor)
        app.post('/doctors', async (req, res) => {
            //access body from file
            const name = req.body.name;
            const email = req.body.email;
            const phone = req.body.phone;
            //access image from file 
            const image = req.files.image;
            const imageData = image.data;
            const encodedImage = imageData.toString('base64');
            const imageBuffer = Buffer(encodedImage, 'base64');
            //make an object of informations snd send to DB
            const doctorInfo = {
                name: name,
                email: email,
                phone: phone,
                image: imageBuffer
            }
            //send to DB
            const result = await doctorsCollection.insertOne(doctorInfo);
            //send the response
            res.send(result);
        })

        //get doctors info from DB
        app.get('/doctors', async (req, res) => {
            const cursore = doctorsCollection.find({});
            const doctors = await cursore.toArray();
            res.send(doctors);
        })

        //get appointment seraching by id
        app.get('/appointments/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await appointmentsCollection.findOne(query);
            res.send(result);
        })

        //Update payment Status seraching by id
        app.put('/appointments/:id', async (req, res) => {
            const id = req.params.id;
            const payment = req.body;

            const filter = { _id: new ObjectId(id) };
            const options = { upsert: false };

            const updatePaymentInfo = {
                $set: {
                    payment: payment
                }
            };
            const result = await appointmentsCollection.updateOne(filter, updatePaymentInfo, options);
            res.send(result);
        })

        //APi for stripe
        app.post('/create-payment-intent', async (req, res) => {
            const paymentInfo = req.body;
            const amount = paymentInfo.cost * 100;

            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                automatic_payment_methods: {
                    enabled: true,
                },
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })
    }
    finally {
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Hello World!');
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
})