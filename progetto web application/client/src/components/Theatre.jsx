import dayjs from 'dayjs'
import { useEffect, useState } from 'react';
import { Row, Col, Button, Spinner, Alert, Container, Form } from 'react-bootstrap';
import { useNavigate, useLocation } from 'react-router';
import API from '../API.js';

function Seat(props) {

  const seat = props.seat;
  const user = props.user;
  const loggedIn = props.loggedIn;
  const loggedInTotp = props.loggedInTotp;
  const isSelected = props.isSelected;
  const toggleSelection = props.toggleSelection;

  const [timerExpired, setTimerExpired] = useState(false);

  useEffect(() => {

    // Timer is used only if the logged user is who released the seat
    // Admins that deletes seats for other users are not blocked
    if (seat.releasedBy && seat.releasedAt && loggedIn && user && user.id === seat.releasedBy) {

      const releasedTime = new Date(seat.releasedAt).getTime(); // in milliseconds

      // We measure the current time to block the button for exactly 40s from the effective db update
      const now = Date.now();
      const remainingTime = 40000 - (now - releasedTime);

      if (remainingTime > 0) {
        // The place is still blocked
        setTimerExpired(false);

        const timer = setTimeout(() => {
          setTimerExpired(true);
        }, remainingTime);

        return function cleanup() {
          clearTimeout(timer);
        };
      } else {

        // timer already expired
        setTimerExpired(true);
      }
    }
  }, [seat.releasedBy, seat.releasedAt, loggedIn, user]);

  const isModifying = props.isModifying; // Is the user modifying something?
  const modifyReservationId = props.modifyReservationId; // Which is the Id of the reservation the user wants to modify?

  // Firstly we assume that this seat is not occupied
  let isOccupied = false;

  let isMine = false;
  // Is this seat belonging to any reservation of THIS user?
  if(loggedIn && user && seat.ownerID === user.id)
    isMine = true;

  let isPartCurrentModification = false;
  // Is this seat part of the current reservation that we want to modify?
  if(isModifying && seat.reservationId === modifyReservationId)
    isPartCurrentModification = true;


  if (seat.reservationId || seat.reserved === true) { // The seat is part of a reservation stored in the db

    if (!isPartCurrentModification) { // Only the seats that are part of THIS reservation are selectable
      isOccupied = true;
    }
  }
  else if (seat.releasedBy && seat.releasedAt) { // Was the seat deleted before from a reservation?
    if (loggedIn && user && user.id === seat.releasedBy) { // If the user is the author of the previous deletion we may block the seat

      const releasedTime = new Date(seat.releasedAt).getTime();
      const now = Date.now();

      // The seat is occupied IFF 40s are not expired 
      if ((now - releasedTime) < 40000) {
        isOccupied = true;
      }
    }
  }

  let variant = 'outline-secondary';
  const isAdminView = loggedIn && loggedInTotp;

 
  if (isSelected) { // seats belonging to THIS user AND THIS reservation (selectable)
    
    variant = 'primary';

  } 
  
  else if (isMine && !isPartCurrentModification) { // seats belonging to other reservations of THIS user (not selectable)

    variant = 'success';

  } 
  
  else if (isOccupied) { // seats that do not belong to THIS user (not selectable)

    variant = 'secondary';

  } 
  
  else { // Free seats (selectable)

    if(seat.category === 'premium')
      variant = 'outline-warning';
    else
      variant = 'outline-info';

  }

  // Every seat is associated with a tooltip carrying some information
  let tooltipText = `Seat ${seat.rowLabel}${seat.seatNumber}`;

  if (isMine) {

    tooltipText = `Reservation n° ${seat.reservationId}`;

  } else if (isOccupied && isAdminView) {

    // If I'm an admin I can see the tooltip of occupied seats
    tooltipText = `Owner: ${seat.ownerName} \nReservation n° ${seat.reservationId}`;

  } else if (isOccupied) {

    // If I'm a normal user I cannot see the tooltip of occupied seats that do not belong to me
    tooltipText = '';
  }

  return (
    <Button
      variant={variant}
      className="m-1 p-0 d-flex justify-content-center align-items-center"
      disabled={false}
      onClick={() => {
        // A Seat is selectable only if is not occupied and is part of THIS reservation of THIS user
        // Unregistered users cannot select seats
        if (loggedIn && (!isMine || isPartCurrentModification) && !isOccupied) {
          toggleSelection(seat.id);
        }
      }}
      style={{ width: '43px', height: '40px', fontSize: '0.85rem' }}
      title={tooltipText}
    >
      {`${seat.rowLabel}${seat.seatNumber}`}
    </Button>
  );
}


function AutomaticReservationRoute(props) {
  const [numSeats, setNumSeats] = useState(1);

  // seats can be 'normal' or 'premium'
  const [category, setCategory] = useState('normal');
  const [errorMsg, setErrorMsg] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMsg('');

    const automaticRes = {
      numSeats: numSeats,
      category: category
    };

    try {

      await API.createReservation(automaticRes);
      navigate('/');

    } catch (err) {
      setErrorMsg(err.error);
    }
  };

  return (
    <Container>
      <Row className="justify-content-center mt-4">
        <Col md={6}>
          <h2 className="mb-4">Automatic Reservation</h2>
          {errorMsg && <Alert variant="danger">{errorMsg}</Alert>}

          <Form onSubmit={handleSubmit} className="border p-4 rounded bg-light">
            <Form.Group className="mb-3" controlId="formNumSeats">
              <Form.Label>Number of desired seats</Form.Label>
              <Form.Control
                type="number"
                min="1"
                value={numSeats}
                onChange={(e) => setNumSeats(e.target.value === '' ? '' : parseInt(e.target.value))}
              />
            </Form.Group>

            <Form.Group className="mb-4" controlId="formCategory">
              <Form.Label>Category</Form.Label>
              <Form.Select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="normal">Normal</option>
                <option value="premium">Premium</option>
              </Form.Select>
            </Form.Group>

            <div className="d-flex justify-content-between">
              <Button variant="secondary" onClick={() => navigate('/')}>
                Back
              </Button>
              <Button variant="primary" type="submit">
                Book
              </Button>
            </div>
          </Form>
        </Col>
      </Row>
    </Container>
  );
}

function TheatreMap(props) {

  // If true then we are in MODIFY modality
  const isModifying = props.modifyingState.isModifying;
  // Keeps the ID of the reservation that is going to be modified
  const modifyReservationId = props.modifyingState.reservationId;
  // Keeps the id of the seats that belong to modifyReservationId
  const oldSeats = props.modifyingState.currentSeats;

  const [seats, setSeats] = useState([]);
  const [selectedSeats, setSelectedSeats] = useState([...oldSeats]);
  const [waiting, setWaiting] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // In case the user deselects manually all the seat we ask him "Are you sure to delete the entire reservation?"
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const navigate = useNavigate();

  const fetchSeats = () => {
    API.getSeats()
      .then(seatsData => {
        setSeats(seatsData);
        setWaiting(false);
      })
      .catch(err => {
        setErrorMsg(err.error);
        setWaiting(false);
      })
  };

  useEffect(() => {
    fetchSeats();
  }, []);

  useEffect(() => {
    if (isModifying) {
      setSelectedSeats([...oldSeats]); // Make SELECTABLE the seats of the reservation we want to modify
    }
  }, [isModifying, oldSeats]);

  // To select/deselect seats directly from the map
  const toggleSelection = (seatId) => {
    setSelectedSeats(oldSelection => {
      if (oldSelection.includes(seatId)) {
        return oldSelection.filter(id => id !== seatId); // Deselection
      } else {
        return [...oldSelection, seatId]; // Selection
      }
    });
  };

  const handleManualReservation = async () => {
    setErrorMsg('');

    try {
      if (isModifying) { // branch for reservation modification
        // converting string Ids in integer Ids
        const currentSelected = selectedSeats.map(id => Number(id));
        const initial = oldSeats.map(id => Number(id));

        // Only the SELECTED seats that are not part of the old reservation has to be send to the backend
        const seatsToAdd = currentSelected.filter(id => !initial.includes(id));
        // Only the DESELECTED seats that were part of the old selection has to be send to the backend
        const seatsToRemove = initial.filter(id => !currentSelected.includes(id));

        if (selectedSeats.length === 0) {
          setShowDeleteConfirm(true);
          return; // Modification demanded to deleteRes upon user confirmation
        }

        await API.updateReservation(modifyReservationId, seatsToAdd, seatsToRemove);

        props.clearModification();

        navigate('/');

      } else { // branch for reservation creation
        const reservation = { seats: selectedSeats.map(id => Number(id)) };
        await API.createReservation(reservation);
      }

      setSelectedSeats([]);
      fetchSeats();
    } catch (err) {
      setErrorMsg(err.error);
      fetchSeats();
    }
  };

  // This method serves to handle the manual deletion of all seats without adding new seats
  // That is basically a manual reservation deletion (see updateReservation in backend)
  const deleteRes = async () => {
    setErrorMsg('');
    try {
      // seatsToAdd is empty, seatsToRemove keeps ALL the OLD seats
      const seatsToRemove = oldSeats.map(id => Number(id));

      
      await API.updateReservation(modifyReservationId, [], seatsToRemove);

      setShowDeleteConfirm(false);

      props.clearModification();

      navigate('/');

      fetchSeats();

    } catch (err) {
      setErrorMsg(err.error);
      setShowDeleteConfirm(false);
      fetchSeats();
    }
  };

  // Grouping seats per row labels, which become the keys
  // Useful later for displaying the map
  const rows = {};
  seats.forEach(seat => {
    if (!rows[seat.rowLabel]) {
      rows[seat.rowLabel] = [];
    }
    rows[seat.rowLabel].push(seat);
  });

  return (
    <Container fluid className="px-0">
      {errorMsg && (
        <Row className="mx-0"><Col className="px-4"><Alert variant="danger">{errorMsg}</Alert></Col></Row>
      )}

      {/* Buttons: AUTOMATIC RESERVATIONS and SHOW RESERVATIONS */}
      {props.loggedIn && (
        <Row className="mx-0 mb-3">
          <Col className="px-4 d-flex justify-content-between">
            <Button variant="outline-primary" onClick={() => navigate('/reservations')}>
              Show Reservations
            </Button>
            <Button variant="outline-primary" onClick={() => {
                  props.clearModification(); // Necessary to clear the state in case we click the button from MODIFY modality
                  navigate('/automatic-reservation');
                }
              }>
              Automatic Reservation
            </Button>
          </Col>
        </Row>
      )}

      {/* Colours legend */}
      <Row className="mb-4 mx-0 border py-2 rounded bg-light">
        <Col className="px-2 d-flex justify-content-center flex-wrap gap-4">
          <div className="d-flex align-items-center">
            <Button variant="success" className="p-0 me-2" style={{ width: '25px', height: '25px', pointerEvents: 'none' }} />
            <span style={{ fontSize: '0.9rem' }}>Your seats</span>
          </div>
          <div className="d-flex align-items-center">
            <Button variant="primary" className="p-0 me-2" style={{ width: '25px', height: '25px', pointerEvents: 'none' }} />
            <span style={{ fontSize: '0.9rem' }}>Selected</span>
          </div>
          <div className="d-flex align-items-center">
            <Button variant="outline-info" className="p-0 me-2" style={{ width: '25px', height: '25px', pointerEvents: 'none' }} />
            <span style={{ fontSize: '0.9rem' }}>Free (standard)</span>
          </div>
          <div className="d-flex align-items-center">
            <Button variant="outline-warning" className="p-0 me-2" style={{ width: '25px', height: '25px', pointerEvents: 'none' }} />
            <span style={{ fontSize: '0.9rem' }}>Free (premium)</span>
          </div>
          <div className="d-flex align-items-center">
            <Button variant="secondary" className="p-0 me-2" style={{ width: '25px', height: '25px', pointerEvents: 'none' }} />
            <span style={{ fontSize: '0.9rem' }}>Occupied / Blocked</span>
          </div>
        </Col>
      </Row>

      {waiting ? (
        <Row className="mx-0"><Col className="px-4"><Spinner animation="border" /></Col></Row>
      ) : (
        // w-100: dictates to occupy all the horizontal space
        // overflow-x-auto: scrollbar
        <div className="w-100 overflow-x-auto ">
          {/* max-content prevents the seats row to be compressed and go to the next line */}
          {/* 0 auto centers the map */}
          <div style={{ minWidth: 'max-content', margin: '0 auto' }}>
            <div className="d-flex justify-content-center mb-4">
              <div className="bg-dark text-white text-center w-75 p-2 rounded">STAGE</div>
            </div>

            {Object.keys(rows).sort().map(rowLabel => (
              // For each letter creates a row
              <div key={rowLabel} className="d-flex align-items-center justify-content-center mb-2">
                {rows[rowLabel].sort((a, b) => a.seatNumber - b.seatNumber).map(seat => (
                  // For each number in the row creates a seat
                  <Seat
                    key={seat.id}
                    seat={seat}
                    user={props.user}
                    loggedInTotp={props.loggedInTotp}
                    loggedIn={props.loggedIn}
                    // If true than the seat is SELECTED; UNSELECTED otherwise
                    isSelected={selectedSeats.includes(seat.id)}
                    toggleSelection={toggleSelection}
                    isModifying={isModifying}
                    modifyReservationId={modifyReservationId}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {showDeleteConfirm ? (
        <Row className="mt-5">
          <Col className="text-center">
            <h4 className="mb-4">Proceeding with deleting the entire reservation?</h4>
            <Button variant="danger" className="me-3" onClick={deleteRes}>
              Yes
            </Button>
            <Button variant="secondary" onClick={() => {
              setShowDeleteConfirm(false);
              setSelectedSeats(oldSeats);
            }}>
              No
            </Button>
          </Col>
        </Row>
      ) : (
        (selectedSeats.length > 0 || isModifying) && (
          <Row>
            <Col className="text-center px-4">
              <h5>Confirm Reservation?</h5>
              <Button variant="primary" style={{ width: '80px', height: '45px' }}
                onClick={handleManualReservation}>
                Yes
              </Button>
              <Button variant="danger" className="ms-2" style={{ width: '80px', height: '45px' }}
                onClick={() => setSelectedSeats(isModifying ? [...oldSeats] : [])}>
                Clear
              </Button>
            </Col>
          </Row>
        )
      )}
    </Container>
  );
}


export { TheatreMap, AutomaticReservationRoute };