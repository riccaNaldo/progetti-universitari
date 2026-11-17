import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { GenericLayout, NotFoundLayout } from './components/Layout.jsx';
import { LoginForm, TotpForm } from './components/Auth.jsx';

import { TheatreMap, AutomaticReservationRoute } from './components/Theatre.jsx';
import { ReservationsTable } from './components/ReservationTable.jsx';
import API from './API.js';





function LoginWithTotp(props) {
  if (props.loggedIn) {
    if (props.user.canDoTotp) {
      if (props.loggedInTotp) {
        return <Navigate replace to='/' />;
      } else {
        return <TotpForm 
                 totpSuccessful={() => props.setLoggedInTotp(true)} 
                 setLoggedIn={props.setLoggedIn} 
               />;
      }
    } else {
      return <Navigate replace to='/' />;
    }
  } else {
    return <LoginForm login={props.login} />;
  }
}

function App() {
  const [user, setUser] = useState(undefined);
  const [loggedIn, setLoggedIn] = useState(false);
  const [loggedInTotp, setLoggedInTotp] = useState(false);
  const [message, setMessage] = useState('');

  const [modifyingState, setModifyingState] = useState({
    isModifying: false,  
    reservationId: null, 
    currentSeats: []
  });

  const clearModification = () => {
    setModifyingState({
      isModifying: false,  
      reservationId: null, 
      currentSeats: []
    });
  };

  // Check on active session
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const user = await API.getUserInfo();
        setLoggedIn(true);
        setUser(user);
        if (user.isTotp) {
          setLoggedInTotp(true);
        }
      } catch (err) {
        // No action: the user is simply not logged
      }
    };
    checkAuth();
  }, []);

  const handleLogin = async (credentials) => {
    try {
      const user = await API.logIn(credentials);
      setUser(user);
      setLoggedIn(true);
      setMessage('');
    } catch (err) {
      throw err; // This error will be handled by LoginForm
    }
  };

  const doLogOut = async () => {
    await API.logOut();
    setLoggedIn(false);
    setUser(undefined);
    setLoggedInTotp(false);
    setMessage('');
  };

  return (
    <Routes>
      <Route path='/' element={
        <GenericLayout 
          user={user} 
          loggedIn={loggedIn} 
          loggedInTotp={loggedInTotp} 
          logout={doLogOut} 
          message={message} 
          setMessage={setMessage} 
        />}
      >
        <Route index element={
          <TheatreMap 
          loggedIn={loggedIn} 
          user={user} 
          loggedInTotp={loggedInTotp}
          modifyingState={modifyingState} 
          clearModification={clearModification}
          />} 
        />
        
        <Route path='automatic-reservation' element={

          // Route protection: if not logged, the system redirects to login page
          // It is not sufficient to hide the button: also the route need to be protected!
          loggedIn ? 
          <AutomaticReservationRoute user={user} /> 
          : <Navigate replace to='/login' />
        } />

        <Route path='reservations' element={
          loggedIn ? 
          <ReservationsTable 
            loggedIn={loggedIn} 
            user={user} 
            loggedInTotp={loggedInTotp} 
            setModifyingState={setModifyingState}
            clearModification={clearModification}
          />
          : 
          <Navigate replace to='/login' />
        } />
        <Route path='*' element={<NotFoundLayout />} />
      </Route>
      
      <Route path='/login' element={
        <LoginWithTotp 
          login={handleLogin} 
          loggedIn={loggedIn} 
          user={user} 
          loggedInTotp={loggedInTotp} 
          setLoggedInTotp={setLoggedInTotp} 
          setLoggedIn={setLoggedIn}
        />} 
      />
    </Routes>
  );
}


export default App;