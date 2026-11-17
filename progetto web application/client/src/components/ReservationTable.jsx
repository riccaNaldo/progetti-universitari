import { useState, useEffect } from 'react';
import { Container, Row, Col, Table, Button, Alert, Spinner, Badge } from 'react-bootstrap';
import { useNavigate } from 'react-router';
import API from '../API.js';

function ReservationsTable(props) {
  const [reservations, setReservations] = useState([]);
  const [waiting, setWaiting] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const navigate = useNavigate();

  const fetchReservations = async () => {
    try {
      const reservedSeats = await API.getReservedSeats();

      // we will display reservations in a table based on the reservation_id
      // for this reason we have to group the seats based on the reservation_id in a dictionary
      const groupedSeats = {};


      for (let i = 0; i < reservedSeats.length; i++) {
        const seat = reservedSeats[i];
        const resId = seat.reservationId;

        // resId is the key of the dictionary
        if (groupedSeats[resId] === undefined) {
          groupedSeats[resId] = {
            id: resId,
            category: seat.category,
            ownerName: seat.ownerName,
            seats: []
          };
        }

        // for each key, add an array made up of the corresponding seats
        groupedSeats[resId].seats.push({
          id: seat.id,
          label: `${seat.rowLabel}${seat.seatNumber}`
        });
      }

      // Convert the dictionary in array containing only the values
      setReservations(Object.values(groupedSeats));
      setWaiting(false);

    } catch (err) {

      setErrorMsg(err.error);
      setWaiting(false);

    }
  };

  useEffect(() => {
    fetchReservations();
  }, []);

  const deleteEntireReservation = async (resId) => {
    setErrorMsg(''); // reset potential obsolete errors
    try {

      await API.deleteReservation(resId);
      fetchReservations(); // re-rendering

    } catch (err) {

      setErrorMsg(err.error);
    }
  };

  const removeSingleSeat = async (resId, seatId) => {
    setErrorMsg('');
    try {

      await API.updateReservation(resId, undefined, [seatId]);
      fetchReservations();

    } catch (err) {

      setErrorMsg(err.error);
    }
  };

  const modifyReservation = (reservation) => {

    const currentSeatIds = reservation.seats.map(seat => seat.id);

    props.setModifyingState({
      isModifying: true,
      reservationId: reservation.id,
      currentSeats: currentSeatIds
    });


    navigate('/');
  };

  const isLoggedAdmin = props.user && props.loggedIn && props.user.canDoTotp && props.loggedInTotp;

  return (
    <Container className="mt-4">
      <Row className="mb-3">
        <Col>
          <h2>{isLoggedAdmin ? "Reservations (admin)" : "Reservations (user)"}</h2>
        </Col>
        <Col xs="auto">
          <Button variant="outline-primary" onClick={() => {
                // Clean the state before returning to the map
                props.clearModification();
                navigate('/');
              }
            }>
            Back to Map
          </Button>
        </Col>
      </Row>

      {errorMsg && (
        <Row>
          <Col>
            <Alert variant="danger">{errorMsg}</Alert>
          </Col>
        </Row>
      )}

      {waiting ? (
        <Row className="justify-content-center"><Spinner animation="border" /></Row>
      ) : reservations.length === 0 ? (
        <Row><Col><Alert variant="info">Reservations not found</Alert></Col></Row>
      ) : (
        <Row>
          <Col>
            <Table striped bordered hover responsive>
              <thead className="table-dark">
                <tr>
                  <th>N°</th>
                  {isLoggedAdmin && <th>Owner</th>}
                  <th>Category</th>
                  <th>Seats</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map(res => (
                  <tr key={res.id}>
                    <td className="align-middle">{res.id}</td>

                    {isLoggedAdmin && (
                      <td className="align-middle">{res.ownerName}</td>
                    )}

                    <td className="align-middle text-capitalize">{res.category}</td>

                    <td className="align-middle">
                      <div className="d-flex flex-wrap gap-2">
                        {res.seats.map(seat => (
                          <Button
                            key={seat.id}
                            variant="primary"
                            size="sm"
                            className="d-flex align-items-center p-2"
                            style={{ fontSize: '0.9rem' }}
                            onClick={() => {
                              // If the last seat is deleted, the entire reservation has to canceled too
                              if (res.seats.length > 1) {
                                removeSingleSeat(res.id, seat.id);
                              } else {
                                deleteEntireReservation(res.id);
                              }
                            }}
                          >
                            {seat.label}
                            <i className="bi bi-x-circle-fill ms-2 text-white"></i>
                          </Button>
                        ))}
                      </div>
                    </td>

                    <td className="align-middle">
                      <div className="d-flex gap-2">

                        {/* Button for entire modification */}
                        <Button
                          variant="warning"
                          size="sm"
                          onClick={() => modifyReservation(res)}
                        >
                          Modify
                        </Button>

                        {/* Button for entire deletion */}
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => deleteEntireReservation(res.id)}
                        >
                          Delete All
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Col>
        </Row>
      )}
    </Container>
  );
}

export { ReservationsTable };