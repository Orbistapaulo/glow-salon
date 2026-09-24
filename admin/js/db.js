// Every call the CRM makes to Supabase. Functions throw an Error whose message is
// already fit to show to the person using the CRM (error.friendly is true).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

export const configured = /^https?:\/\//.test(SUPABASE_URL);
export const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const NO_PERMISSION = "You don't have permission for that.";

export function friendlyError(err) {
  const message = String(err?.message || err || "");
  const code = err?.code;
  if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed/i.test(message)) return "No connection: changes aren't saved.";
  if (code === "42501" || /permission denied|row-level security/i.test(message)) return NO_PERMISSION;
  if (code === "invalid_credentials" || /Invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (code === "23505") return "That already exists.";
  return "Something went wrong. Try again.";
}

function fail(message) {
  const error = new Error(message);
  error.friendly = true;
  throw error;
}

async function run(query, special) {
  const { data, error } = await query;
  if (error) fail(special?.(error) || friendlyError(error));
  return data;
}

// Updates hidden by the access rules return no rows instead of an error.
function one(rows) {
  if (!rows || !rows.length) fail(NO_PERMISSION);
  return rows[0];
}

const safeSearch = (q) => q.replace(/[,()*%\\]/g, " ").trim();

// Logins ---------------------------------------------------------------------
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) fail(friendlyError(error));
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin/` });
  if (error) fail(friendlyError(error));
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) fail(error.message && /at least|weak|short/i.test(error.message) ? error.message : friendlyError(error));
}

export async function getMyProfile() {
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return null;
  const profile = await run(supabase.from("staff_profiles").select("*").eq("user_id", user.id).maybeSingle());
  return profile || { user_id: user.id, email: user.email, full_name: null, role: "none" };
}

// Salon setup ----------------------------------------------------------------
export const getSettings = () => run(supabase.from("salon_settings").select("*").eq("id", 1).single());

export const getStaffGroups = () => run(supabase.from("staff_groups").select("*").order("name"));

export function getServices({ includeInactive = true } = {}) {
  let q = supabase.from("services").select("*").order("sort_order").order("id");
  if (!includeInactive) q = q.eq("is_active", true);
  return run(q);
}

export const getClosedDates = (fromDate) =>
  run(supabase.from("closed_dates").select("*").gte("closed_on", fromDate).order("closed_on"));

export async function saveService(service) {
  const fields = {
    name: service.name, description: service.description, icon: service.icon,
    duration_minutes: service.duration_minutes, price: service.price, staff_group: service.staff_group,
    is_active: service.is_active, sort_order: service.sort_order
  };
  if (service.id) return one(await run(supabase.from("services").update(fields).eq("id", service.id).select()));
  return one(await run(supabase.from("services").insert(fields).select()));
}

export async function swapServiceOrder(a, b) {
  one(await run(supabase.from("services").update({ sort_order: b.sort_order }).eq("id", a.id).select()));
  one(await run(supabase.from("services").update({ sort_order: a.sort_order }).eq("id", b.id).select()));
}

export async function saveStaffGroup(group, isNew) {
  const special = (e) => (e.code === "23505" ? "A group with that name already exists." : null);
  if (isNew) return one(await run(supabase.from("staff_groups").insert(group).select(), special));
  return one(await run(supabase.from("staff_groups").update({ staff_count: group.staff_count }).eq("name", group.name).select()));
}

export const saveSettings = async (fields) =>
  one(await run(supabase.from("salon_settings").update(fields).eq("id", 1).select()));

export async function addClosedDate(date, reason) {
  const special = (e) => (e.code === "23505" ? "That date is already marked as closed." : null);
  return one(await run(supabase.from("closed_dates").insert({ closed_on: date, reason: reason || null }).select(), special));
}

export const removeClosedDate = async (date) =>
  one(await run(supabase.from("closed_dates").delete().eq("closed_on", date).select()));

// Bookings -------------------------------------------------------------------
export const getAvailableSlots = (date, serviceId) =>
  run(supabase.rpc("get_available_slots", { p_booking_date: date, p_service_id: serviceId }));

export const createBooking = (b) => run(supabase.rpc("create_booking", {
  p_full_name: b.full_name, p_phone: b.phone, p_email: b.email || null, p_service_id: b.service_id,
  p_booking_date: b.booking_date, p_start_time: b.start_time, p_notes: b.notes || null,
  p_sms_opt_in: Boolean(b.sms_opt_in), p_source: b.source
}));

export const listDayBookings = (date) =>
  run(supabase.from("booking_details").select("*").eq("booking_date", date).order("start_time"));

export const listUpcomingBookings = (fromDate) =>
  run(supabase.from("booking_details").select("*").gte("booking_date", fromDate)
    .in("status", ["pending", "confirmed"]).order("booking_date").order("start_time"));

export const setBookingStatus = async (id, status) =>
  one(await run(supabase.from("bookings").update({ status }).eq("id", id).select()));

export const setBookingNotes = async (id, notes) =>
  one(await run(supabase.from("bookings").update({ notes: notes || null }).eq("id", id).select()));

// Customers ------------------------------------------------------------------
export const findCustomerByPhone = (phone) =>
  run(supabase.from("customers").select("*").eq("phone", phone).maybeSingle());

export function searchCustomers(q) {
  const term = safeSearch(q || "");
  let query = supabase.from("customers").select("*").limit(50);
  if (term) query = query.or(`full_name.ilike.*${term}*,phone.ilike.*${term}*`).order("full_name");
  else query = query.order("created_at", { ascending: false });
  return run(query);
}

export const getCustomer = (id) => run(supabase.from("customers").select("*").eq("id", id).single());

export async function updateCustomer(id, fields) {
  const special = (e) => (e.code === "23505" ? "Another customer already has that phone number." : null);
  return one(await run(supabase.from("customers").update(fields).eq("id", id).select(), special));
}

export const listCustomerBookings = (customerId) =>
  run(supabase.from("booking_details").select("*").eq("customer_id", customerId)
    .order("booking_date", { ascending: false }).order("start_time", { ascending: false }));

// Staff logins ---------------------------------------------------------------
export const listStaffProfiles = () => run(supabase.from("staff_profiles").select("*").order("created_at"));

export const setStaffRole = async (userId, role) =>
  one(await run(supabase.from("staff_profiles").update({ role }).eq("user_id", userId).select()));
