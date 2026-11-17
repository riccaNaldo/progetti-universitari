import { Row, Col, Alert, Container, Button } from 'react-bootstrap';
import { Outlet, Link } from 'react-router'; // react-router v6+ usa 'react-router' o 'react-router-dom'
import { Navigation } from './Navigation.jsx';

function NotFoundLayout() {
  return (
    <Container fluid className="text-center mt-5">
      <h2>This route is not valid!</h2>
      <Link to="/">
        <Button variant="primary" className="mt-3">Go back to the main page</Button>
      </Link>
    </Container>
  );
}

function GenericLayout(props) {
  return (
    <>
      <Row>
        <Col>
          <Navigation 
            loggedIn={props.loggedIn} 
            user={props.user} 
            loggedInTotp={props.loggedInTotp} 
            logout={props.logout} 
          />
        </Col>
      </Row>

      <Container fluid className="mt-3">
        <Row>
          <Col>
            {props.message ? (
              // dismissible allows to delete the error message from the interface
              <Alert className='my-1' onClose={() => props.setMessage('')} variant='danger' dismissible>
                {props.message}
              </Alert>
            ) : null}
          </Col>
        </Row>

        <Outlet />
        
      </Container>
    </>
  );
}

export { GenericLayout, NotFoundLayout };