import dayjs from 'dayjs'; // To handle 40 seconds timeouts
import db from './db.mjs';

const convertSeatFromDbRecord = (dbRecord) => {
  const seat = {};

  seat.id = dbRecord.seatId;
  seat.rowLabel = dbRecord.row_label;
  seat.seatNumber = dbRecord.seat_number;
  seat.reservationId = dbRecord.reservation_id;
  seat.releasedBy = dbRecord.released_by;
  seat.releasedAt = dbRecord.released_at;

  if (seat.rowLabel === 'A' || seat.rowLabel === 'B')
    seat.category = 'premium';
  else
    seat.category = 'normal';

  // To trace who the seat belongs to
  seat.ownerID = dbRecord.user_id;
  seat.ownerName = dbRecord.owner_name;

  // It will be useful to know the seat status for unregistered users
  seat.reserved = false
  if(seat.reservationId)
    seat.reserved = true;

    

  return seat;
}


/*** SHARED HELPERS  ***/

// Helper to generate question marks dynamically in order to insert them into the SQL string
// based on the number of seats to add/remove
const generateQuestionMarks = (length) => {
  let result = "";

  for (let i = 0; i < length; i++) {
    result += "?";
    if (i < length - 1) {
      result += ", ";
    }
  }
  return result;
}

const getSeatsLabels = (seatIDs) => {
  return new Promise((resolve, reject) => {

    const questionMarks = generateQuestionMarks(seatIDs.length);
    const sql = `SELECT row_label, seat_number FROM seats WHERE id IN (${questionMarks})`;

    db.all(sql, seatIDs, (err, rows) => {
      if(err)
        reject(err);
      else
        resolve(rows.map(r => `${r.row_label}${r.seat_number}`).join(', '));
    });
  });
}

// Returns free seats that can be used for modifying/creating a reservation
// - userId = user that wants to create/modify a reservation
// - seatsIDs = seats that want to add to a new/modified reservation
// - if resId != NULL then the user wants to modify an existing reservation
const getSeatsByIDs = (userId, seatsIDs, resId = null) => {
  return new Promise((resolve, reject) => {

    // 40 seconds before this moment
    const thresholdTime = dayjs().subtract(40, 'second').toISOString();
    const questionMarks = generateQuestionMarks(seatsIDs.length);

    let sqlAdjustment = "";
    const params = [...seatsIDs];
    if(resId){
      sqlAdjustment = "OR reservation_id = ?";
      params.push(resId);
    }

    params.push(userId, thresholdTime);

    // Only free seats (creation) and those belonging to the current reservation (modification) can be manipulated (see sqlAdjustment)
    const sql = `
      SELECT id AS seatId, row_label, seat_number, reservation_id, released_by, released_at 
      FROM seats 
      WHERE id IN (${questionMarks}) 
      AND (reservation_id IS NULL ${sqlAdjustment}) 
      AND (released_by IS NULL OR released_by != ? OR released_at <= ?)
    `;

    db.all(sql, params, (err, rows) => {
      if (err)
        reject(err);
      else {
        const availableSeats = rows.map(e => {
          const availableSeat = convertSeatFromDbRecord(e);
          return availableSeat;
        });
        resolve(availableSeats);
      }
    });
  });
}

// Helper to add the 'new' seats to the reservation
// It will be used also by createReservation() (principal INSERT METHOD)
const addSeats = (resId, seatsIDsToAdd) => {
  return new Promise((resolve, reject) => {

    const questionMarks = generateQuestionMarks(seatsIDsToAdd.length);

    const sqlUpdate = `
      UPDATE seats 
      SET reservation_id = ?, released_by = NULL, released_at = NULL 
      WHERE id IN (${questionMarks})
    `;

    db.run(sqlUpdate, [resId, ...seatsIDsToAdd], function (err) {

      if (err)
        reject(err);
      else
        resolve(this.changes);
    });
  });
};

// Helper for updateReservation() to check if the user is enabled to modify the reservation
const checkPermission = (resId, userId, isLoggedAdmin) => {
  return new Promise((resolve, reject) => {

    const sql = `
      SELECT r.user_id 
      FROM reservations r 
      JOIN users u ON r.user_id = u.id 
      WHERE r.id = ?
    `;
    
    db.get(sql, [resId], (err, row) => {
      if (err) return reject(err);
      if (!row) return reject({ status: 404, message: "Reservation not found" });
      
      // IF the user is who is claiming to be 
      // OR
      // IF the user is an admin
      // THEN allow the operation
      if ( (userId === row.user_id) || isLoggedAdmin ) {
        resolve(row.user_id);
      } else {
        reject({ status: 401, message: "Permission denied: unauthorized action" });
      }
    });
  });
}

/*****************************************************************************/



/*** GET METHODS ***/
const listAllSeats = (isLoggedAdmin, reqUser = null) => {
  return new Promise((resolve, reject) => {
    // LEFT JOIN to show the entire map otherwise only the booked places would be displayed on the client interface
    const sql = `
      SELECT seats.id AS seatId, seats.row_label, seats.seat_number, seats.reservation_id, seats.released_by, seats.released_at, reservations.user_id, users.name AS owner_name 
      FROM seats 
      LEFT JOIN reservations ON seats.reservation_id = reservations.id 
      LEFT JOIN users ON reservations.user_id = users.id
    `;

    db.all(sql, [], (err, rows) => {
      if (err)
        reject(err);
      else {
        let isOwner = false;
        const seats = rows.map(e => {
          let seat = convertSeatFromDbRecord(e);

          let isOwner = false;
          if(reqUser && (reqUser.id === seat.ownerID) )
            isOwner = true;

          let isReleaser = false;
          if(reqUser && (reqUser.id === seat.releasedBy) )
            isReleaser = true;


          // We avoid to send sensitive data to the user client when the user:
          // - is not the owner of the reservation
          // AND
          // - is not a logged admin
          // AND
          // - is not who released the reservation (to block seats after deletion)
          if(!isOwner && !isLoggedAdmin && !isReleaser){
            // Undefined deletes the fields from the future JSON
            seat.reservationId = undefined;
            seat.ownerID = undefined;
            seat.ownerName = undefined;
            seat.releasedBy = undefined;
            seat.releasedAt = undefined;
          }
          return seat;
        });

        resolve(seats);
      }
    })
  })
}

// It returns the list of reserved seats for a specific authenticated user
// OR 
// the list of ALL the reserved seats for logged admins
const getReservedSeats = (userId, isLoggedAdmin) => {
  return new Promise((resolve, reject) => {
    let sql = `
      SELECT seats.id AS seatId, seats.row_label, seats.seat_number, seats.reservation_id, seats.released_by, seats.released_at, reservations.user_id, users.name AS owner_name 
      FROM seats 
      JOIN reservations ON seats.reservation_id = reservations.id 
      LEFT JOIN users ON reservations.user_id = users.id 
    `;

    let uId = [];

    if (!isLoggedAdmin) {
      // normal users can see only their reservations
      sql += ` WHERE reservations.user_id = ?`;
      uId.push(userId);
    }


    db.all(sql, uId, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        const reservedSeats = rows.map(e => {
          const reservedSeat = convertSeatFromDbRecord(e);
          return reservedSeat;
        });
        resolve(reservedSeats);
      }
    });
  });
};
/********************************************************************************/


/*** DELETION METHODS ***/

// Helper for releasing seats in SEATS
const releaseSeats = (resId, userId) => {
  return new Promise((resolve, reject) => {
    const deletionMoment = dayjs().toISOString();

    let sql = "UPDATE seats SET reservation_id = NULL, released_by = ?, released_at = ? WHERE reservation_id = ?";
   

    db.run(sql, [userId, deletionMoment, resId], function (err) {
      if (err)
        reject(err);
      else
        resolve(this.changes);
    });
  });
};

// Principal method that calls releaseSeats() and then DELETES the row from RESERVATIONS
const deleteReservation = async (resId, userId, isLoggedAdmin) => {

  const ownerId = await checkPermission(resId, userId, isLoggedAdmin);


  // By passing ownerId we block the original owner of the seat from rebooking it within 40s
  // Admins who delete seats for other users will not be blocked
  await releaseSeats(resId, ownerId);

  return new Promise((resolve, reject) => {
    let sqlDelete = "DELETE FROM reservations WHERE id = ?";


    db.run(sqlDelete, [resId], function (err) {
      if (err)
        reject(err);
      else
        resolve(this.changes);
    });
  });
};
/***************************************************************************/


/*** UPDATE METHODS ***/

// Helper to remove 'old' seats from the reservation
// Differently from releaseSeats it is used for modifying a reservation and not for deleting it
const removeSeats = (resId, userId, seatsIDsToRemove) => {
  return new Promise((resolve, reject) => {

    const deletionMoment = dayjs().toISOString();
    const questionMarks = generateQuestionMarks(seatsIDsToRemove.length);

    const sqlUpdate = `
      UPDATE seats SET reservation_id = NULL, released_by = ?, released_at = ? 
      WHERE reservation_id = ? 
      AND id IN (${questionMarks})
    `;

    db.run(sqlUpdate, [userId, deletionMoment, resId, ...seatsIDsToRemove], function (err) {

      if (err)
        reject(err);
      else
        resolve(this.changes);
    });
  });
};


// Principal method that calls both the previous helpers
const updateReservation = async (resId, userId, isLoggedAdmin, seatsIDsToAdd = null, seatsIDsToRemove = null) => {

  // Admins can update any reservation;
  // authenticated users only those they posses.
  const ownerId = await checkPermission(resId, userId, isLoggedAdmin);

  // How many seats does the evaluated reservation contain?
  const currentSeatsCount = await new Promise((resolve, reject) => {
    const sql = "SELECT COUNT(*) as count FROM seats WHERE reservation_id = ?";
    db.get(sql, [resId], (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });

  const numToAdd = seatsIDsToAdd ? seatsIDsToAdd.length : 0;
  const numToRemove = seatsIDsToRemove ? seatsIDsToRemove.length : 0;
  
  const finalSeatsCount = currentSeatsCount - numToRemove + numToAdd;

  // If the user deletes all the seats singularly, the reservation too has to be deleted from the DB
  if (finalSeatsCount <= 0) {
    await deleteReservation(resId, userId, isLoggedAdmin);
    return true;
  }

  // "partial" update: no reservation deletion
  if (seatsIDsToAdd && seatsIDsToAdd.length > 0) {
    const availableSeats = await getSeatsByIDs(ownerId, seatsIDsToAdd, resId);

    if (availableSeats.length !== seatsIDsToAdd.length) {
      const availableIDs = availableSeats.map(seat => seat.id);
      const unavailableIDs = seatsIDsToAdd.filter(id => !availableIDs.includes(id));

      const labels = await getSeatsLabels(unavailableIDs);
      throw { status: 403, message: `${labels} already reserved or temporarily blocked.` };
    }
  }

  
  if (seatsIDsToRemove && seatsIDsToRemove.length > 0)
    await removeSeats(resId, ownerId, seatsIDsToRemove);

  if (seatsIDsToAdd && seatsIDsToAdd.length > 0)
    await addSeats(resId, seatsIDsToAdd);

  return true;
};
/************************************/


/*** INSERT METHODS ***/

// Get all the free seats from a specifiec category and list them in order (e.g "A1", "A2", ect.)
const getSeatsByCategory = (userId, category) => {
  return new Promise((resolve, reject) => {

    const thresholdTime = dayjs().subtract(40, 'second').toISOString();

    let rowCondition = "";
    // Thanks to the validation in index.mjs only this two categories are admitted
    if (category === 'premium') {
      rowCondition = "row_label IN ('A', 'B')";
    }
    else{ // normal category
      rowCondition = "row_label NOT IN ('A', 'B')";
    }

    // The ORDER BY condition is fundamental to simplify the logic in verifySeatsAvailability()
    // released_by == NULL means that the seat has never been reserved
    // released_by != userId means that the seat was booked and released by another user
    // if the previous condition is not satisfied we need to check the temporal constraint with realesed_at <= thresholdTime
    const sql = `
      SELECT id AS seatId, row_label, seat_number, reservation_id, released_by, released_at 
      FROM seats 
      WHERE ${rowCondition} 
      AND reservation_id IS NULL 
      AND (released_by IS NULL OR released_by != ? OR released_at <= ?) 
      ORDER BY row_label, seat_number
    `;

    db.all(sql, [userId, thresholdTime], (err, rows) => {
      if (err)
        reject(err);
      else{
        const categorizedSeats = rows.map(e => {
          const categorizedSeat = convertSeatFromDbRecord(e);
          return categorizedSeat;
        });
        resolve(categorizedSeats);
      }
        
    });
  });
};

const verifySeatsAvailability = async (userId, seatsIDs, numSeats, category) => {

  // MANUAL modality
  if (seatsIDs && seatsIDs.length > 0) {
    const availableSeats = await getSeatsByIDs(userId, seatsIDs);

    if (availableSeats.length !== seatsIDs.length) {

      const availableIDs = availableSeats.map(seat => seat.id);
      const unavailableIDs = seatsIDs.filter(id => !availableIDs.includes(id));

      const labels = await getSeatsLabels(unavailableIDs);
      throw { status: 403, message: `${labels} already reserved or temporarily blocked.` }
      
    }
    
    // Seats are free
    return seatsIDs;
  }
  else // AUTOMATIC modality
  {
    const availableSeats = await getSeatsByCategory(userId, category);

    if (availableSeats.length < numSeats) {
      throw { status: 422, message: `Not enough seats available of type '${category}'.` };
    }

    // Grouping seats by row
    const groupedByRow = {};
    for (const seat of availableSeats) {
      if (!groupedByRow[seat.rowLabel]) {
        groupedByRow[seat.rowLabel] = [];
      }
      groupedByRow[seat.rowLabel].push(seat);
    }

    let selectedSeats = [];

    // Firstly, we must search for a row that is free enough to host all the guests
    for (const letter in groupedByRow) {
      const rowAvailableSeats = groupedByRow[letter];

      if (rowAvailableSeats.length >= numSeats) {

        // This part relies heavily on the ORDER BY clause in the SQL string of getSeatsByCategory()
        const adjacentSeats = rowAvailableSeats.slice(0, numSeats);

        selectedSeats = adjacentSeats.map(seat => seat.id);

        break;
      }
    }

    // This is the 'simplest' case: no row keeping enough available seats
    if (selectedSeats.length === 0) {
      const sparseSeats = availableSeats.slice(0, numSeats);
      selectedSeats = sparseSeats.map(seat => seat.id);
    }

    return selectedSeats;


  }
};


// Principal method that 'gathers' the functionality of the others
const createReservation = async (userId, seatsIDsToBook = null, numSeats = null, category = null) => {

  const selectedSeatsIds = await verifySeatsAvailability(userId, seatsIDsToBook, numSeats, category);


  const resId = await new Promise((resolve, reject) => {
    const sql = "INSERT INTO reservations (user_id) VALUES (?)";
    db.run(sql, [userId], function (err) {
      if (err) {
        reject(err);
      } else {
        // this.lastID keeps the primary key just created in reservations
        resolve(this.lastID);
      }
    });
  });

  // with this.lastID we update reservation_id field in seats table
  try{
    await addSeats(resId, selectedSeatsIds);
  }
  catch(err){
    // If addSeats fails, we must delete the row inserted in RESERVATIONS table by db.run()
    await new Promise((resolve, reject) => {
      const sql = "DELETE FROM reservations WHERE id = ?";
      db.run(sql, [resId], (err, rows) => {
        if(err)
          reject(err);
        else
          resolve()
      })
    });
    throw err;
  }
  
  
  return {
    reservationId: resId,
    bookedSeats: selectedSeatsIds
  };
};
/************************************************/

export default {
  listAllSeats,
  getReservedSeats,
  deleteReservation,
  updateReservation,
  createReservation
}