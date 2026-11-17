
import express from 'express';
import morgan from 'morgan';
import { check, validationResult, query, param, body } from 'express-validator';  // validation middleware
import cors from 'cors';

import passport from 'passport';
import LocalStrategy from 'passport-local';
import { TOTP } from 'otpauth';

import theatreDao from './theatre_dao.mjs';
import userDao from './users_dao.mjs';

const responseDelay = 1000;

const app = new express();
const corsOptions = {
  origin: 'http://localhost:5173',
  credentials: true,
};

app.use(cors(corsOptions));
app.use(morgan('dev'));
app.use(express.json());

passport.use(new LocalStrategy(async function verify(username, password, callback) {
  const user = await userDao.getUser(username, password)
  if (!user)
    return callback(null, false, 'Incorrect username or password');

  return callback(null, user); 
}));


passport.serializeUser(function (user, callback) { 
  callback(null, user);
});


passport.deserializeUser(function (user, callback) { 
  return callback(null, user); 
});


import session from 'express-session';

app.use(session({
  secret: "esame1-webApp-la-stringa-deve-essere-lunga",
  resave: false,
  saveUninitialized: false,
}));

app.use(passport.authenticate('session'));


function verifyTotpToken(user, token) {
  const totp = new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: user.secret
  });


  const delta = totp.validate({ token, window: 1 });
  if (delta === null) {
    return false; 
  }


  const currentCounter = totp.counter();
  const actualStep = currentCounter + delta;
  
  if (actualStep <= user.lastTotpStep)
    return false;  
  

  user.lastTotpStep = actualStep;
  return true;
}



const isLoggedIn = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ error: 'Not authenticated' });
}


const errorFormatter = ({ location, msg, param, value, nestedErrors }) => {
  return `${location}[${param}]: ${msg}`;
};



app.get('/api/seats', (req, res) => {

  let isLoggedAdmin = false;
  if (req.user && req.user.isAdmin && req.session.method === 'totp') {
    isLoggedAdmin = true;
  }

  theatreDao.listAllSeats(isLoggedAdmin, req.user)
    .then(seats => res.json(seats))
    .catch(err => {
      console.log(err);
      res.status(500).json({ error: 'Database error' });
    });

})


app.get('/api/reservations', isLoggedIn, (req, res) => {

  // If the user can be an Admin AND it has already authenticated with TOTP 
  // it must see the entire map
  let isLoggedAdmin = false;
  if(req.user && req.user.isAdmin && req.session.method === 'totp'){
    isLoggedAdmin = true;
  }

  theatreDao.getReservedSeats(req.user.id, isLoggedAdmin)
    .then(seats => res.json(seats))
    .catch(err => {
      console.log(err);
      res.status(500).json({ error: 'Database error' });
    });

})


app.delete('/api/reservations/:id', isLoggedIn, 
  [check('id').isInt({ min: 1 })],
  async (req, res) => {

    const errors = validationResult(req).formatWith(errorFormatter);

    if (!errors.isEmpty()) {
      return res.status(422).json(errors.errors);
    }

    try {
      const resId = req.params.id;
      const userId = req.user.id;
      
      let isLoggedAdmin = false;
      if(req.user.isAdmin && req.session.method === 'totp'){
        isLoggedAdmin = true;
      }

      await theatreDao.deleteReservation(resId, userId, isLoggedAdmin);

      res.status(204).end();
    }
    catch (err) { 
      res.status(err.status).json({ error: err.message });
    }
  });

app.put('/api/reservations/:id', isLoggedIn,
  [
    check('id').isInt({ min: 1 }),
    check('seatsToAdd').optional().isArray(),
    // Every single element of the array must be an integer
    check('seatsToAdd.*').isInt({ min: 1 }),
    check('seatsToRemove').optional().isArray(),
    check('seatsToRemove.*').isInt({ min: 1 })
  ], async (req, res) => {

    const errors = validationResult(req).formatWith(errorFormatter);

    if (!errors.isEmpty()) {
      return res.status(422).json(errors.errors);
    }

    const resId = req.params.id;
    const userId = req.user.id;

    let isLoggedAdmin = false;
    if (req.user.isAdmin && req.session.method === 'totp') {
      isLoggedAdmin = true;
    }

    const seatsToAdd = req.body.seatsToAdd || [];
    const seatsToRemove = req.body.seatsToRemove || [];
    
    // If both arrays are empty, return an error
    if (seatsToAdd.length === 0 && seatsToRemove.length === 0) {
      return res.status(400).json({ error: "Empty arrays for adding/removing seats." });
    }

    // We must avoid the case when seatsToAdd and seatsToRemove keep the same seats
    // This would allow to bypass the 40s constraint
    const intersection = seatsToAdd.filter(seat => seatsToRemove.includes(seat));
    if (intersection.length > 0) {
      return res.status(400).json({ error: "Removing and adding the same seat in the same request is forbidden." });
    }


    try {
      await theatreDao.updateReservation(resId, userId, isLoggedAdmin, seatsToAdd, seatsToRemove);
      res.status(204).end();
    }
    catch (err) {
      const status = err.status; 
      res.status(status).json({ error: err.message });
    }
});

app.post('/api/reservations', isLoggedIn, 
  [
  body('seats').optional().isArray().withMessage('Seats must be an array'),
  body('seats.*').optional().isInt({ min: 1 }),
  body('numSeats').optional().isInt({ min: 1 }).withMessage('Number of seats must be at least 1'),
  body('category').optional().isIn(['premium', 'normal']).withMessage('Invalid category'),
], async (req, res) => {

  const errors = validationResult(req).formatWith(errorFormatter);
  if (!errors.isEmpty()) {
    return res.status(422).json(errors.errors);
  }

  const userId = req.user.id;
  const seats = req.body.seats;
  const numSeats = req.body.numSeats;
  const category = req.body.category;

  if ( (!seats || seats.length === 0) && (!numSeats || !category)) {
    return res.status(400).json({ error: "Provide either seats (manual) or numSeats and category (automatic)" });
  }

  try {

    const result = await theatreDao.createReservation(userId, seats, numSeats, category);

    res.status(201).json(result);

  } catch (err) {

    // Catching the specific error from the DAO
    // Specifically, from verifySeatsAvailability() and updateReservation()
    const status = err.status;
    res.status(status).json({ error: err.message });
  }
});


/** API for User AuthN **/

function clientUserInfo(req) {
  const user = req.user;
  return { id: user.id, username: user.username, name: user.name, canDoTotp: user.secret ? true : false, isTotp: req.session.method === 'totp', isAdmin: user.isAdmin };
}


app.post('/api/sessions', function (req, res, next) {
  passport.authenticate('local', (err, user, info) => {
    if (err)
      return next(err);
    if (!user) {

      return res.status(401).json({ error: info });
    }
    
    req.login(user, (err) => {
      if (err){
        return next(err);
      }

        return res.json(clientUserInfo(req));
    });
  })(req, res, next);
});

app.post('/api/login-totp', isLoggedIn,

  async (req, res) => {
    if (!req.user.secret) {
      console.log('TOTP not enabled for this user');
      return res.status(400).json({ error: 'Cannot authenticate with TOTP' });
    }
    const success = verifyTotpToken(req.user, req.body.code);
    if (success) {
      req.session.method = 'totp';
      try {

        await userDao.updateLastTotpStep(req.user.id, req.user.lastTotpStep);

      } catch (err) {
        console.log(err);
        return res.status(503).json({ error: 'Database error' });
      }
      return res.json({ otp: 'authorized' });
    } else {
      console.log('Invalid or replayed TOTP code');
      return res.status(401).json({ error: 'Cannot authenticate with TOTP' });
    }
  }
);


app.get('/api/sessions/current', (req, res) => {
  if (req.isAuthenticated()) {
    res.status(200).json(clientUserInfo(req));
  }
  else
    res.status(401).json({ error: 'Not authenticated' });
});


app.delete('/api/sessions/current', isLoggedIn, (req, res) => {
  req.logout(() => {
    res.status(200).json({});
  });
});


const port = 3001;


app.listen(port, (err) => {
  if (err)
    console.log(err);
  else
    console.log(`Server listening at http://localhost:${port}`);
}); 
