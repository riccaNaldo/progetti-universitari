import 'bootstrap-icons/font/bootstrap-icons.css';
import { Navbar, Nav, Form, Button } from 'react-bootstrap';
import { useNavigate } from 'react-router';
import { LoginButton, LogoutButton } from './Auth';

const Navigation = (props) => {
    const navigate = useNavigate();

    return (
        <Navbar bg="primary" expand="md" variant="dark" className="navbar-padding">
            <Navbar.Brand className="mx-2">
                <i className="bi bi-ticket-perforated mx-2" />
                Theater Reservations
            </Navbar.Brand>
            
            <Nav className="ms-auto align-items-center">
                <Navbar.Text className="mx-2 fs-5">
                    {props.user && props.user.name && 
                    `Logged in ${props.loggedInTotp ? '(2FA)' : ''} as: ${props.user.name}`}
                </Navbar.Text>
                
                {/* 2FA button for admins who initally skipped the 2FA */}
                {props.loggedIn && props.user && props.user.canDoTotp && !props.loggedInTotp && (
                    <Button 
                        variant="light" 
                        size="sm" 
                        className="mx-3"
                        onClick={() => navigate('/login')}
                    >
                        Complete 2FA
                    </Button>
                )}

                {/* Logout button */}
                <Form className="mx-2 mt-1">
                    {props.loggedIn ? <LogoutButton logout={props.logout} /> : <LoginButton />}
                </Form>
            </Nav>
        </Navbar>
    );
}

export { Navigation };