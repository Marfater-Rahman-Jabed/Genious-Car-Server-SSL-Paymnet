const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const SSLCommerzPayment = require('sslcommerz-lts');
const store_id = process.env.SSL_Store_Id;
const store_passwd = process.env.SSL_PassWord;
const is_live = false;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;


app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_User}:${process.env.DB_Password}@cluster0.4jznvny.mongodb.net/?retryWrites=true&w=majority`;

console.log(uri);
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// function verifyJWT(req, res, next) {
//     const AuthValid = req.headers.authorization;
//     if (!AuthValid) {
//         return res.status(401).send({ message: 'unAuthorised access' });
//     }
//     const token = AuthValid.split(' ')[1];
//     jwt.verify(token, process.env.Access_Token_Secret, function (error, decoded) {
//         if (error) {
//             return res.status(401).send({ message: 'unAuthorised access' });
//         }
//         req.decoded = decoded;
//         next();
//     })
// }



function verifyJWT(req, res, next) {
    const AuthValid = req.headers.authorization;
    if (!AuthValid) {
        return res.status(401).send({ message: 'UnAuthorised access' });
    }
    const token = AuthValid.split(' ')[1];
    jwt.verify(token, process.env.Access_Token_Secret, function (error, decoded) {
        if (error) {
            return res.status(401).send({ message: 'UnAuthorised access' });
        }
        req.decoded = decoded;
        next();
    })

}


async function run() {
    try {
        const serviceCollection = client.db('GeniusCar').collection('service');
        const orderCollection = client.db('GeniusCar').collection('orders');

        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.Access_Token_Secret, { expiresIn: '1h' })
            res.send({ token })
        })

        app.get('/services', async (req, res) => {
            const order = req.query.order;
            const search = req.query.search
            console.log(search)
            let query = {};
            if (search.length) {
                query = {
                    $text: {
                        $search: search
                    }
                }
            }

            const cursor = serviceCollection.find(query).sort({ price: order == 'asc' ? 1 : -1 });
            const result = await cursor.toArray();
            // console.log(result);
            res.send(result)
        })
        app.get('/services/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await serviceCollection.findOne(query)
            res.send(result);
        })

        app.get('/orders', verifyJWT, async (req, res) => {

            const decoded = req.decoded;
            if (decoded.email !== req.query.email) {
                return res.status(401).send({ message: 'UnAuthorised access' });
            }




            // const decoded = req.decoded;
            // console.log(decoded);

            // if (decoded.email !== req.query.email) {
            //     return res.status(401).send({ message: 'unAuthorised access' });
            // }

            let query = {};
            if (req.query.email) {
                query = {
                    email: req.query.email,
                }
            }

            const cursor = orderCollection.find(query);
            const result = await cursor.toArray();
            res.send(result);
        })

        app.post('/orders', async (req, res) => {
            // const order = req.body;
            // const result = await orderCollection.insertOne(order);
            // res.send(result);

            const order = req.body;
            const orderedProduct = await serviceCollection.findOne({ _id: new ObjectId(order.service) })
            // console.log(orderedProduct);
            const transectionId = new ObjectId().toString()
            const data = {
                total_amount: orderedProduct.price,
                currency: order.currency,
                tran_id: transectionId, // use unique tran_id for each api call
                success_url: `http://localhost:5000/payment/success?transectionId=${transectionId}`,
                fail_url: `http://localhost:5000/payment/fail?transectionId=${transectionId}`,
                cancel_url: 'http://localhost:5000/payment/cancel',
                ipn_url: 'http://localhost:3030/ipn',
                shipping_method: 'Courier',
                product_name: order.serviceName,
                product_category: 'Electronic',
                product_profile: 'general',
                cus_name: order.customer,
                cus_email: order.email,
                cus_add1: order.address,
                cus_add2: 'Dhaka',
                cus_city: 'Dhaka',
                cus_state: 'Dhaka',
                cus_postcode: '1000',
                cus_country: 'Bangladesh',
                cus_phone: order.phone,
                cus_fax: '01711111111',
                ship_name: 'Customer Name',
                ship_add1: 'Dhaka',
                ship_add2: 'Dhaka',
                ship_city: 'Dhaka',
                ship_state: 'Dhaka',
                ship_postcode: 1000,
                ship_country: 'Bangladesh',
            };
            console.log(data);
            // res.send(data)
            const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live)
            sslcz.init(data).then(apiResponse => {
                // Redirect the user to payment gateway
                let GatewayPageURL = apiResponse.GatewayPageURL
                orderCollection.insertOne({
                    ...order, transectionId, paid: false
                })
                res.send({ url: GatewayPageURL })
                // console.log('Redirecting to: ', GatewayPageURL)
            });

        })

        app.post('/payment/success', async (req, res) => {
            // console.log("success");
            const { transectionId } = req.query;
            const result = await orderCollection.updateOne({ transectionId }, {
                $set: {
                    paid: true,
                    paitAt: new Date()
                }
            })
            if (result.modifiedCount > 0) {
                res.redirect(`http://localhost:3000/payment/success?transectionId=${transectionId}`)
            };

        })
        app.post('/payment/fail', async (req, res) => {
            const { transectionId } = req.query;
            const result = await orderCollection.deleteOne({ transectionId });
            if (result.deletedCount) {
                res.redirect(`http://localhost:3000/payment/fail?transectionId=${transectionId}`)
            }
        })

        app.get('/orders/transection-id/:id', async (req, res) => {
            const { id } = req.params;
            const result = await orderCollection.findOne({ transectionId: id })
            res.send(result)

        })

        app.delete('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result)
        })


    }
    finally {

    }

}
run().catch(error => console.log(error))


app.get('/', (req, res) => {
    res.send('server is running')
})

app.listen(port, () => {
    console.log(`port is running on ${port}`)
})