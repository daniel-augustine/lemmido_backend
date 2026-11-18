# Slot Check — Helper Scheduling Rules

| | |
|---|---|
| **Version** | 0.1 (draft) |
| **Date** | 2026-11-17 |
| **Applies to** | Every booking change that puts work on a helper's schedule |
| **Related** | [datamodel.md §7 Helper assignment and availability](./datamodel.md) |

These rules decide whether a helper can take a task. The backend runs them on every change (R6). A change that breaks any rule is rejected unless an authorised role overrides it (R10).

**Terms**

- **Task time** = service time + travel time, rounded up to the next 30 min.
- **Work** = task time. The rest gaps between tasks are not work.
- **Shift** = a run of tasks with no 8h break between them. A task that starts less than 8h after the previous one ends joins that shift, so it must fit inside the shift's 12h span (R4). This is what gives every shift at least 8h of rest before it.
- **Break** = any time between two tasks. Breaks are never stored; they are the gaps between `job_starts_at` and `ends_at` of the helper's tasks. See [Breaks](#breaks-are-derived-not-stored).

---

## Summary

| Rule | Limit |
|---|---|
| R1 Slot grid | Starts and ends on :00 or :30. Task length 30 min to 9h. |
| R2 Gap | At least 1h between two tasks of the same helper. |
| R3 Daily cap | At most 9h of work in any 24h period. |
| R4 Shift span | At most 12h from a shift's first start to its last end. |
| R5 Weekly limits | At most 40h of work in any 7-day period, plus a 24h break in every 7-day period. |
| R6 Validate every change | Re-check R1–R5 from 7 days before to 7 days after the change. |
| R7 Overruns | Use the actual end and re-check later tasks. |
| R8 Concurrency | One transaction, a lock per helper, all or nothing. |
| R9 Time | UTC, real elapsed time. Local time for display only. |
| R10 Overrides | Authorised role only, with a reason and a review. Overrides still count. |

---

## R1. Slot grid

- Every start and end falls on :00 or :30.
- A task lasts at least 30 min and at most 9h.
- Task time (service + travel) is always rounded up to the next 30 min.

## R2. Gap between tasks

Between any two tasks of the same helper, the gap is at least 1h. Travel is inside task time, so this hour is pure rest.

## R3. Rolling daily cap

No 24h period may contain more than 9h of work. To check this when booking a new task, sum the work in these windows and reject the booking if any total is over 9h:

- `[new.end − 24h, new.end]`
- `[t.end − 24h, t.end]` for each existing task `t` that ends after `new.end` and before `new.end + 24h`

Count only the part of a task that falls inside the window.

## R4. Shift span

- A shift runs at most 12h from its first start to its last end.
- This guarantees at least 8h of rest before every shift, at any time of day, so it replaces the 11 am night-break rule.

## R5. Weekly limits

- No 7-day period may contain more than 40h of work. Check this the same way as R3, with 7-day windows: one ending at `new.end`, plus one ending at each later task's end within the next 7 days.
- Every 7-day period includes at least one stretch of 24h with no tasks.

## R6. Validate every change

- Every create, reschedule, extension, cancellation and multi-helper booking re-checks R1–R5 for the helper's tasks from 7 days before to 7 days after the change.
- If a change alters where the helper comes from before the next task, recalculate that task's travel time first.

## R7. Overruns

- When a task's actual end passes its booked end, use the actual end and re-validate the helper's later tasks.
- Any later task that now breaks a rule is flagged and reassigned before it starts.
- Late arrivals caused by slow travel count as overruns.

## R8. Bookings at the same time

- Validation and insert happen in one transaction, holding a lock on each helper involved.
- A booking that needs several helpers succeeds for all of them or none.

## R9. Time handling

- Do all arithmetic in UTC, as real elapsed time, so daylight-saving days stay correct.
- Local time is for display only.

## R10. No unchecked overrides

- Only an authorised role can override, with a recorded reason and a review afterwards.
- Overrides still count when checking R3–R5 for later bookings.

---

## Check order

For one helper and one proposed change:

1. Lock the helper (R8). For a multi-helper booking, lock every helper involved.
2. Load the helper's tasks from 7 days before to 7 days after the change (R6), including overrides (R10) and actual ends of overrun tasks (R7).
3. If the change moves where the helper comes from, recalculate the next task's travel time (R6).
4. Round task times up to 30 min and check the grid and length (R1).
5. Check the 1h gap to the tasks before and after (R2).
6. Check the 24h windows (R3) and the 7-day windows (R5).
7. Check the shift span (R4) and the 24h weekly break (R5).
8. Any rule broken → reject and roll back for every helper. Otherwise insert and commit.

All times in steps 2–7 are UTC (R9).

### Window check (R3 and R5)

```text
check_windows(tasks, new, length, cap):        # R3: 24h, 9h   R5: 7d, 40h
    ends = [new.end] + [t.end for t in tasks
                        if new.end < t.end < new.end + length]
    for end in ends:
        start = end - length
        work  = sum(overlap(t, start, end) for t in tasks + [new])
        if work > cap: reject

overlap(t, start, end) = max(0, min(t.end, end) - max(t.start, start))
```

### Weekly 24h break check (R5)

"Every 7-day period has a 24h stretch with no tasks" is the same as:

> From the end of one 24h-or-longer break to the start of the next, there are at most **5 days**.

Why: a 7-day window misses a 24h break only if it can sit between two of them, overlapping each by less than 24h. That needs the work stretch between them to be longer than 7d − 24h − 24h = 5d.

```text
check_weekly_rest(tasks):
    gaps = [(a.end, b.start) for consecutive a, b in sorted(tasks)]
    long = [g for g in gaps if g.end - g.start >= 24h]
    for each consecutive pair (g1, g2) in long:
        if g2.start - g1.end > 5d: reject
```

---

## Breaks are derived, not stored

Don't keep a break in a column (like today's `bookings.blocked_until`) and read it to find free helpers. Work out breaks from the tasks each time you check.

| Stored break column | Derived from tasks |
|---|---|
| Right only for a fixed rule, like "8h after a job over 9h" | Works for every rule here (R2–R5) |
| Goes stale on every cancel, reschedule, extension and overrun | Always current: it's just the tasks |
| Can't see that a new task *before* an existing one breaks the 24h or 7-day cap for the later one | R3 and R5 check the windows ending at later tasks too |
| One break per task | A helper's rest depends on all their tasks around it |

### What each rule does for rest

| Rule | Gives rest? | How |
|---|---|---|
| R2 Gap | Yes, 1h | Between any two tasks |
| R3 Daily cap | **No break of its own** | It caps work at 9h in any 24h, so 15h of every 24h is free, but that free time can be split into 1h gaps. It never forces one long break |
| R4 Shift span | Yes, 8h | Before every shift (see *Shift* in Terms) |
| R5 Weekly | Yes, 24h | At least one in every 7 days |

So the 24h window (R3) limits **how much** a helper works, not **when** they rest. The real breaks come from R2, R4 and R5, and all three are checked from the tasks alone.

**Leave is different.** Time a helper isn't working at all (holiday, sick day) is not a break between tasks. Store it as rows in a `helper_time_off` table and treat each row as a blocked period in the overlap check. It doesn't count as work in R3–R5, and it does count as rest for the R5 24h break.

---

## Implementation steps

### 1. Schema (`packages/db`)

1. `bookings`: keep `job_starts_at` and `ends_at` as the task's start and end (task time, rounded up to 30 min). Remove `blocked_until` and the "8h break after 9h" rule. R1 caps a task at 9h, so a job over 9h can't exist any more.
2. Add check constraints for R1:
   - `extract(epoch FROM job_starts_at)::bigint % 1800 = 0`, and the same for `ends_at`
   - `ends_at - job_starts_at BETWEEN interval '30 minutes' AND interval '9 hours'`
3. Add an index on `bookings (helper_id, ends_at)` for the window queries. The `(helper_id, job_starts_at)` one stays.
4. New table `schedule_overrides` (R10): `override_id`, `booking_id`, `helper_id`, `rules_broken` (text[]), `reason`, `overridden_by`, `created_at`, `reviewed_by`, `reviewed_at`.
5. New table `helper_time_off`: `helper_id`, `starts_at`, `ends_at`, `reason`.
6. Multi-helper bookings (R8): `bookings.helper_id` holds one helper. If a booking can need more than one, move helpers to a `booking_helpers (booking_id, helper_id)` table, one task per row.

### 2. Rule engine (`packages/shared/src/slot-check.ts`)

A pure function with no database access, so it's easy to test:

```ts
type Task = { id: string; start: Date; end: Date; override?: boolean };
type Violation = { rule: "R1" | "R2" | "R3" | "R4" | "R5"; taskId: string; message: string };

checkSchedule(tasks: Task[], timeOff: Period[]): Violation[]
```

- `roundUpToSlot(ms)`: rounds up to the next 30 min (R1).
- `checkGrid`: start and end on :00 or :30, length 30 min to 9h (R1).
- `checkGaps`: sorted tasks, `next.start − prev.end ≥ 1h` (R2).
- `checkWindows(24h, 9h)` and `checkWindows(7d, 40h)`: windows ending at the new task's end and at each later task's end, counting only the part inside (R3, R5).
- `groupShifts`: split sorted tasks wherever the gap is 8h or more; each group's `last.end − first.start ≤ 12h` (R4).
- `checkWeeklyRest`: at most 5 days between consecutive 24h breaks (R5).

All maths in epoch milliseconds (UTC, R9). Override tasks are included like any other task (R10).

### 3. Load a helper's tasks

`loadHelperTasks(tx, helperId, from, to)` reads the helper's open bookings (`bookingsAreOpen`) that overlap `[change.start − 8d, change.end + 8d]`. R6 asks for ±7 days; the extra day lets the shift and weekly-break checks see the tasks just outside. Use `ends_at`, which already moves later when a job runs over (R7).

### 4. Validate inside one transaction (R8)

```text
BEGIN
  lock every helper involved, in user_id order (avoids deadlocks):
      SELECT 1 FROM users WHERE id IN (...) ORDER BY id FOR UPDATE
  for each helper:
      tasks = loadHelperTasks(...)
      recalculate the next task's travel if its start point changed (R6)
      apply the change to tasks in memory
      violations = checkSchedule(tasks)
      any violation (and no override) → ROLLBACK, return violations
  write the change for every helper
COMMIT
```

Today every job starts and ends at base, so the travel step does nothing. It matters once jobs are chained from one customer to the next.

### 5. Call it from every change (R6)

One function, `applyScheduleChange(change)`, used by: assign (path A after payment, path B on approval), change helper, reschedule, extension, cancellation and multi-helper bookings. No route writes `helper_id`, `job_starts_at` or `ends_at` any other way.

### 6. Available helpers and slots

1. **SQL prefilter:** drop helpers with a task or time off overlapping `[start − 1h, end + 1h]` (R1, R2). This is the existing `NOT EXISTS` query with `blocked_until` swapped for `ends_at + 1h`.
2. **Rule engine:** for each helper left, load tasks once for the whole date range and run `checkSchedule` with the candidate task added (R3–R5).
3. Sort by fewest hours that week, as today.
4. **Date picker:** do the same for each `TIME_SLOTS` start on each day. Convert each IST slot to UTC first (R9). Load all helpers' tasks for the visible range in one query, not one per slot.

Showing a slot still doesn't hold a helper. Step 4 runs again on submit and on assignment.

### 7. Overruns (R7)

When the helper's update or the 10-minute check pushes `ends_at` later:

1. Re-run `checkSchedule` on the helper's tasks for the next 7 days.
2. Each later task with a violation gets an `admin_alerts` row (`next_at_risk`, with the rule broken in the message).
3. The admin reassigns or cancels it before it starts.
4. A late start caused by slow travel is handled the same way: it pushes `ends_at`.

### 8. Overrides (R10)

An admin-only endpoint that takes the change plus a reason. It runs step 4, and if the only problem is violations, it writes the change plus a `schedule_overrides` row instead of rolling back. Open overrides (`reviewed_at IS NULL`) are listed on the admin dashboard for review.

### 9. Tests

- One table-driven unit test file per rule, with boundaries: exactly 30 min and 9h tasks, exactly 1h gap, exactly 9h in 24h, exactly 12h span, exactly 40h in 7 days, exactly 5 days between 24h breaks.
- A task that only partly falls inside a window.
- A new task placed **before** existing ones that breaks a later window (R3, R5).
- Two bookings for the same helper at the same moment: only one succeeds (R8).
- A multi-helper booking where one helper fails: none are booked (R8).
- An overrun that flags the next task (R7).

### 10. Update `datamodel.md`

These rules replace parts of [datamodel.md §7](./datamodel.md):

- `blocked_until` and the 8h break after jobs over 9h → R2–R5.
- "Effort 9h or less is auto-approved, more needs an admin" → R1 caps every task at 9h, so a job over 9h can't be booked as one task at all, even by an admin. It needs splitting or more than one helper.
- "Available = windows don't overlap" → the prefilter plus the rule engine (step 6).
