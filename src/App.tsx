import { Navigate, Route, Routes, Outlet } from 'react-router'
import { StoreProvider, ToastViewport } from './state/StoreContext'
import { AuthProvider } from './state/AuthContext'
import Auth from './pages/Auth'
import { initObservability } from './lib/observability'
import { firebaseEnabled } from '../config/firebase'
import ServiceUnavailable from './pages/ServiceUnavailable'
import TabBar from './components/TabBar'
import Home from './pages/Home'
import Explore from './pages/Explore'
import Profile from './pages/Profile'
import Calls from './pages/Calls'
import Country from './pages/Country'
import Installation from './pages/Installation'
import EsimDetail from './pages/EsimDetail'
import Wallet from './pages/Wallet'
import Call from './pages/Call'
import Help from './pages/Help'
import GetConnected from './pages/GetConnected'
import Legal from './pages/Legal'
import SupportChat from './pages/SupportChat'
import ChooseNumberCountry from './pages/ChooseNumberCountry'
import PickNumber from './pages/PickNumber'
import VerifyNumber from './pages/VerifyNumber'

/** tab screens get the iOS-style bottom tab bar */
function TabsLayout() {
  return (
    <div className="min-h-dvh bg-[#0A0A0A]">
      <Outlet />
      <TabBar />
    </div>
  )
}

initObservability()

export default function App() {
  // FAIL-CLOSED: without the Firebase public config there is no auth, no
  // orders, no cloud sync — a single unavailable screen, never a partial
  // app and never a fake backend.
  if (!firebaseEnabled) return <ServiceUnavailable />

  return (
    <AuthProvider>
      <StoreProvider>
      <Routes>
        <Route element={<TabsLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        <Route path="/auth" element={<Auth />} />
        <Route path="/country/:slug" element={<Country />} />
        <Route path="/install/:orderId" element={<Installation />} />
        <Route path="/esims/:iccid" element={<EsimDetail />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/call/:slug" element={<Call />} />
        <Route path="/number/country" element={<ChooseNumberCountry />} />
        <Route path="/number/pick" element={<PickNumber />} />
        <Route path="/number/verify" element={<VerifyNumber />} />
        <Route path="/help" element={<Help />} />
        <Route path="/setup/:orderId" element={<GetConnected />} />
        <Route path="/legal/:doc" element={<Legal />} />
        <Route path="/support/chat" element={<SupportChat />} />
        {/* static preview has no server rewrites — send unknown paths home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastViewport />
      </StoreProvider>
    </AuthProvider>
  )
}
