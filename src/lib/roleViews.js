// Role view registry (Master Spec §11.1). Landing = the role view.
// Hotel is now a wired dashboard (Stage 2); the rest remain shaped empty states
// until their vertical slice is built.
import { HotelView } from '../pages/roles/HotelView.jsx'
import { HubView, ProcessorView, GovernmentView, LabView, BuyerView, FinanceView } from '../pages/roles/RoleViews.jsx'

export const ROLE_VIEWS = {
  hotel:          HotelView,
  recovery_hub:   HubView,
  processor:      ProcessorView,
  government:     GovernmentView,
  university_lab: LabView,
  buyer:          BuyerView,
  finance:        FinanceView,
}

export const ROLE_LABELS = {
  hotel: 'Hotel',
  recovery_hub: 'Recovery Hub',
  processor: 'Processor',
  government: 'Government',
  university_lab: 'Universities / Labs',
  buyer: 'Buyer / Exchange',
  finance: 'Finance',
}
