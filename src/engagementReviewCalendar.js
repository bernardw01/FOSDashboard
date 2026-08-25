/**
 * PRD version 3.16.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 037: Calendar invites for Engagement Reviews (auth Users only).
 */

/**
 * @return {GoogleAppsScript.Calendar.Calendar}
 */
function erResolveCalendar_() {
  var props = PropertiesService.getScriptProperties();
  var calId = String(props.getProperty('ENGAGEMENT_REVIEW_CALENDAR_ID') || '').trim();
  if (calId) {
    return CalendarApp.getCalendarById(calId);
  }
  return CalendarApp.getDefaultCalendar();
}

/**
 * @param {string} reviewId
 * @param {string} webAppUrl
 * @return {!{ ok: boolean, message?: string, calendarEventId?: string, invited?: !Array<string>, skipped?: !Array<string> }}
 */
function erCreateOrUpdateCalendarEvent_(reviewId, webAppUrl) {
  var bundle = erGetReviewBundle_(reviewId);
  if (!bundle.ok) return bundle;
  var review = bundle.review;
  var participants = bundle.participants || [];
  var userSet = erAuthUserEmailSet_();
  var invited = [];
  var skipped = [];
  var guestEmails = [];
  for (var i = 0; i < participants.length; i++) {
    var em = normalizeEmail_(String(participants[i].email || ''));
    if (!em) continue;
    if (!userSet[em]) {
      skipped.push(em);
      continue;
    }
    guestEmails.push(em);
  }
  var target = String(review.target_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) {
    return { ok: false, message: 'Review target date is invalid.' };
  }
  var parts = target.split('-');
  var start = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
    10,
    0,
    0
  );
  var end = new Date(start.getTime() + 60 * 60 * 1000);
  var deep =
    String(webAppUrl || '').trim() ||
    String(ScriptApp.getService().getUrl() || '').trim();
  if (deep.indexOf('?') >= 0) {
    deep += '&';
  } else if (deep) {
    deep += '#';
  }
  // Prefer hash deep link consumed by the shell.
  var link = String(ScriptApp.getService().getUrl() || deep || '');
  var desc =
    'Engagement Review: ' +
    String(review.name || '') +
    '\nTarget date: ' +
    target +
    '\nEngagements: ' +
    String((bundle.agreements || []).length) +
    '\nOpen in Hub: ' +
    link +
    '#engagement-review/' +
    encodeURIComponent(String(review.id));

  var cal;
  try {
    cal = erResolveCalendar_();
  } catch (e) {
    return {
      ok: false,
      message: 'Could not open calendar. Check ENGAGEMENT_REVIEW_CALENDAR_ID.',
    };
  }
  if (!cal) {
    return { ok: false, message: 'Calendar not found.' };
  }

  var event = null;
  var existingId = review.calendar_event_id ? String(review.calendar_event_id) : '';
  try {
    if (existingId) {
      event = cal.getEventById(existingId);
    }
  } catch (_) {
    event = null;
  }

  try {
    if (event) {
      event.setTitle('Engagement Review: ' + String(review.name || ''));
      event.setTime(start, end);
      event.setDescription(desc);
    } else {
      event = cal.createEvent('Engagement Review: ' + String(review.name || ''), start, end, {
        description: desc,
        sendInvites: true,
        guests: guestEmails.join(','),
      });
    }
  } catch (createErr) {
    return {
      ok: false,
      message:
        'Could not create calendar event: ' +
        (createErr && createErr.message ? createErr.message : 'unknown error'),
    };
  }

  // Ensure guests (for updates / re-send).
  for (var g = 0; g < guestEmails.length; g++) {
    try {
      event.addGuest(guestEmails[g]);
      invited.push(guestEmails[g]);
      erUpsertParticipant_(reviewId, {
        email: guestEmails[g],
        inviteStatus: 'invited',
        inviteSentAt: new Date().toISOString(),
      });
    } catch (_) {
      skipped.push(guestEmails[g]);
    }
  }

  var eventId = '';
  try {
    eventId = event.getId();
  } catch (_) {
    eventId = existingId;
  }
  erUpdateReview_(reviewId, { calendarEventId: eventId }, Session.getActiveUser().getEmail());

  return {
    ok: true,
    calendarEventId: eventId,
    invited: invited,
    skipped: skipped,
  };
}
