# CRM checklist

Run this once on the test project (or right after going live), in a normal browser and on a phone. Tick each line.

## Not approved yet

- [ ] A newly invited login sees "Waiting for the owner to approve your account" and nothing else.
- [ ] Opening `/admin#/schedule` directly still shows the waiting screen.

## Staff

- [ ] The menu shows Schedule, New booking and Customers only.
- [ ] Typing `/admin#/services` in the address bar shows the Schedule instead.
- [ ] Schedule: today's bookings are in time order; Call and Text open the phone's apps.
- [ ] Previous, Today, Next and the date picker change the day.
- [ ] Confirm, Completed and No-show update the badge. Cancel asks first.
- [ ] Notes save and are still there after a reload.
- [ ] The busy strip shows each group's load at booked times.
- [ ] New booking, Walk-in, today: "Now" is offered; the saved booking shows as Walk-in.
- [ ] New booking, Phone: typing an existing customer's number fills in their name.
- [ ] Booking a time that is full shows "Sorry, everyone is booked at that time".
- [ ] Customers: search works by name and by phone typed with spaces.
- [ ] A customer's page shows visits, no-shows, last visit, upcoming and past bookings.
- [ ] Editing a customer to another customer's phone number is refused with a clear message.
- [ ] Book again opens New booking with the customer filled in.

## Owner

- [ ] The menu also shows Services, Hours and Staff (behind More on a phone).
- [ ] Changing a price shows the new price on the website after a reload.
- [ ] Adding a service shows it on the website; hiding it removes it from the website.
- [ ] Hiding a service with upcoming bookings asks first; the bookings stay on the schedule.
- [ ] Moving a service up or down changes the order on the website.
- [ ] Changing a staff group's count changes which times the website offers.
- [ ] Changing opening hours or slot length changes the website's times and footer.
- [ ] Hours that clash with bookings list them and only save after Save anyway.
- [ ] Adding a closed date makes the website say "We're closed that day (reason)."
- [ ] Staff page: a pending login can be set to Staff; your own row cannot be changed.

## Website and chat

- [ ] A normal website booking shows the confirmation and arrives by text.
- [ ] The chat assistant can still check times, book, cancel and reschedule.
- [ ] Turning off Wi-Fi in the CRM shows "No connection: changes aren't saved".
