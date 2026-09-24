// Fake salon data for the CRM browser tests.
import { todayInManila, addDays } from "../../admin/js/format.js";

export const TODAY = todayInManila();
export const TOMORROW = addDays(TODAY, 1);

export const USERS = {
  owner: { id: "u-owner", email: "owner@glow.test", password: "right" },
  staff: { id: "u-staff", email: "staff@glow.test", password: "right" },
  pending: { id: "u-pending", email: "pending@glow.test", password: "right" }
};

const SERVICES = [
  { id: 1, name: "Haircut (Women)", description: "Cut, wash, and blow-dry", icon: "i-scissors", duration_minutes: 60, price: 450, staff_group: "hair", is_active: true, sort_order: 1 },
  { id: 5, name: "Manicure", description: "Shape, clean, and polish", icon: "i-brush", duration_minutes: 45, price: 300, staff_group: "nails", is_active: true, sort_order: 2 },
  { id: 7, name: "Foot Spa", description: "Relaxing soak", icon: "i-drop", duration_minutes: 60, price: 400, staff_group: "nails", is_active: false, sort_order: 3 }
];

function booking(id, customer, service, date, start, status, source = "website", notes = null) {
  const [h, m] = start.split(":").map(Number);
  const end = h * 60 + m + service.duration_minutes;
  const pad = (n) => String(n).padStart(2, "0");
  return {
    id, booking_id: id, booking_date: date, start_time: `${start}:00`,
    end_time: `${pad(Math.floor(end / 60))}:${pad(end % 60)}:00`, status, source, notes, reminder_sent: false,
    customer_id: customer.id, customer_name: customer.full_name, customer_phone: customer.phone,
    customer_email: customer.email, sms_opt_in: customer.sms_opt_in,
    service_id: service.id, service_name: service.name, staff_group: service.staff_group,
    duration_minutes: service.duration_minutes, price: service.price, created_at: `${date}T00:00:00Z`
  };
}

export function adminState() {
  const services = SERVICES.map((s) => ({ ...s }));
  const ana = { id: "c-ana", full_name: "Ana <i>Cruz</i>", phone: "09171234567", email: "ana@example.com", sms_opt_in: true, created_at: "2026-01-01T00:00:00Z" };
  const bea = { id: "c-bea", full_name: "Bea Santos", phone: "09179998888", email: null, sms_opt_in: false, created_at: "2026-02-01T00:00:00Z" };
  // bookings and booking_details share row objects, like the real view over the table
  const rows = [
    booking("b-1", ana, services[1], TODAY, "10:00", "confirmed", "website", "Likes short nails"),
    booking("b-2", bea, services[0], TODAY, "11:00", "pending", "ai_chat"),
    booking("b-3", ana, services[0], addDays(TODAY, -30), "14:00", "completed", "walk_in"),
    booking("b-4", ana, services[0], addDays(TODAY, -10), "15:00", "no_show", "phone")
  ];
  return {
    users: Object.values(USERS),
    tables: {
      staff_profiles: [
        { user_id: USERS.owner.id, email: USERS.owner.email, full_name: "Olivia Owner", role: "owner", created_at: "2026-01-01T00:00:00Z" },
        { user_id: USERS.staff.id, email: USERS.staff.email, full_name: "Sam Staff", role: "staff", created_at: "2026-02-01T00:00:00Z" },
        { user_id: USERS.pending.id, email: USERS.pending.email, full_name: null, role: "none", created_at: "2026-03-01T00:00:00Z" }
      ],
      salon_settings: [{ id: 1, open_time: "09:00:00", close_time: "18:00:00", slot_minutes: 30, closed_weekdays: [], timezone: "Asia/Manila", salon_name: "Glow Salon", salon_phone: "0917 000 0000", require_code: true }],
      staff_groups: [{ name: "hair", staff_count: 2 }, { name: "nails", staff_count: 1 }],
      services,
      closed_dates: [],
      customers: [ana, bea],
      bookings: rows,
      booking_details: rows
    },
    rpc: {
      get_available_slots: ({ p_booking_date, p_service_id }) => ({
        success: true, closed: false, date: p_booking_date, service_id: p_service_id, open_count: 2,
        available_times: [{ time: "13:00", label: "1:00 PM", free_staff: 1 }, { time: "13:30", label: "1:30 PM", free_staff: 1 }]
      }),
      create_booking: (body) => ({ success: true, code: "booked", booking_id: "b-new", message: `You're booked for a service on ${body.p_booking_date}.` })
    }
  };
}
