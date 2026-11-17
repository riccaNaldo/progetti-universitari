const SERVER_URL = 'http://localhost:3001/api/';


function getJson(httpResponsePromise) {
  return new Promise((resolve, reject) => {
    httpResponsePromise
      .then((response) => {
        if (response.ok) {
          // 204 No Content responses don't have a body to parse
          // Otherwise response.json() would rise an error
          if (response.status === 204) {
            return resolve();
          }

          // the server always returns a JSON, even empty {}. Never null or non json, otherwise the method will fail
          response.json()
            .then(json => resolve(json))
            .catch(err => reject({ error: "Cannot parse server response" }))

        } else {
          // analyzing the cause of error
          response.json()
            .then(obj => reject(obj)) // error msg in the response body
            .catch(err => reject({ error: "Cannot parse server response" })) // something else
        }
      })
      .catch(err =>
        reject({ error: "Cannot communicate" })
      ) // connection error
  });
}

/*** Interaction with DB functions ***/

// Getting from the server side the entire map of seats.
const getSeats = async () => {
  return getJson(
    fetch(SERVER_URL + 'seats', { credentials: 'include' })
  );
}


// Getting from the server side the reserved seats for the current user 
// (or all if admin authenticated with TOTP).
const getReservedSeats = async () => {
  return getJson(
    fetch(SERVER_URL + 'reservations', { credentials: 'include' })
  );
}



function createReservation(reservation) {
  return getJson(
    fetch(SERVER_URL + "reservations", {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reservation)
    })
  );
}


// This function updates an existing reservation in the server.
// Requires the reservation ID and arrays of seats to add and remove.
function updateReservation(resId, seatsToAdd, seatsToRemove) {
  const modifiedReservation = {};

  if (seatsToAdd && seatsToAdd.length > 0) 
    modifiedReservation.seatsToAdd = seatsToAdd;

  if (seatsToRemove && seatsToRemove.length > 0) 
    modifiedReservation.seatsToRemove = seatsToRemove;

  return getJson(
    fetch(SERVER_URL + "reservations/" + resId, {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(modifiedReservation)
    })
  );
}


function deleteReservation(resId) {
  return getJson(
    fetch(SERVER_URL + "reservations/" + resId, {
      method: 'DELETE',
      credentials: 'include'
    })
  );
}


/*** Authentication functions ***/


const logIn = async (credentials) => {
  return getJson(fetch(SERVER_URL + 'sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',  // this parameter specifies that authentication cookie must be forwarded
    body: JSON.stringify(credentials),
  })
  );
};


const totpVerify = async (totpCode) => {
  return getJson(fetch(SERVER_URL + 'login-totp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ code: totpCode }),
  })
  );
};


const getUserInfo = async () => {
  return getJson(fetch(SERVER_URL + 'sessions/current', {
    credentials: 'include'
  })
  );
};


const logOut = async () => {
  return getJson(fetch(SERVER_URL + 'sessions/current', {
    method: 'DELETE',
    credentials: 'include'
  })
  );
};

const API = { 
  getSeats, getReservedSeats, createReservation, updateReservation, deleteReservation,
  logIn, totpVerify, getUserInfo, logOut 
};

export default API;