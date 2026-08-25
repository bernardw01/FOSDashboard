/**
 * PRD version 3.10.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 037: Engagement Review standardized questions (code-owned).
 * Responses persist in fos_engagement_updates.answers + executive_summary.
 */

/** @const {number} */
var ENGAGEMENT_REVIEW_QUESTION_SET_VERSION_ = 1;

/**
 * @return {number}
 */
function engagementReviewQuestionSetVersion_() {
  return ENGAGEMENT_REVIEW_QUESTION_SET_VERSION_;
}

/**
 * @return {!Array<!{
 *   key: string,
 *   label: string,
 *   helpText: string,
 *   inputType: string,
 *   required: boolean,
 *   options?: !Array<!{ value: string, label: string }>
 * }>}
 */
function engagementReviewQuestions_() {
  return [
    {
      key: 'executive_summary',
      label: 'Executive summary',
      helpText: 'Short status narrative shown at the top of project detail.',
      inputType: 'textarea',
      required: true,
    },
    {
      key: 'traffic_light',
      label: 'Overall health',
      helpText: 'Green on track, yellow at risk, red off trajectory.',
      inputType: 'traffic_light',
      required: true,
      options: [
        { value: 'green', label: 'Green - On track' },
        { value: 'yellow', label: 'Yellow - At risk' },
        { value: 'red', label: 'Red - Off trajectory' },
      ],
    },
    {
      key: 'financial_health',
      label: 'Financial health notes',
      helpText: 'Margin, pacing, recognition, or cost concerns for this engagement.',
      inputType: 'textarea',
      required: true,
    },
    {
      key: 'delivery_risks',
      label: 'Delivery risks and blockers',
      helpText: 'What could slip scope, timeline, or quality?',
      inputType: 'textarea',
      required: true,
    },
    {
      key: 'customer_sentiment',
      label: 'Customer sentiment',
      helpText: 'Relationship health and recent customer feedback.',
      inputType: 'textarea',
      required: false,
    },
    {
      key: 'staffing_notes',
      label: 'Staffing and capacity',
      helpText: 'Allocation gaps, roll-offs, or over-allocation concerns.',
      inputType: 'textarea',
      required: false,
    },
    {
      key: 'asks_for_leadership',
      label: 'Asks for leadership',
      helpText: 'Decisions or help needed from the review forum.',
      inputType: 'textarea',
      required: false,
    },
  ];
}

/**
 * @return {!{ version: number, questions: !Array<!Object> }}
 */
function getEngagementReviewQuestionSetPayload_() {
  return {
    version: engagementReviewQuestionSetVersion_(),
    questions: engagementReviewQuestions_(),
  };
}

/**
 * @param {*} answers
 * @param {number=} version
 * @return {{
 *   ok: boolean,
 *   message?: string,
 *   answers?: !Object,
 *   executiveSummary?: string,
 *   trafficLight?: string,
 *   questionSetVersion?: number
 * }}
 */
function validateEngagementUpdateAnswers_(answers, version) {
  var ver =
    version != null && isFinite(Number(version))
      ? Number(version)
      : engagementReviewQuestionSetVersion_();
  if (ver !== engagementReviewQuestionSetVersion_()) {
    return {
      ok: false,
      message: 'Question set version is out of date. Reload and try again.',
    };
  }
  var src = answers && typeof answers === 'object' ? answers : {};
  var questions = engagementReviewQuestions_();
  var normalized = {};
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    var raw = src[q.key];
    var val = raw === null || raw === undefined ? '' : String(raw).trim();
    if (q.required && !val) {
      return { ok: false, message: 'Required: ' + q.label };
    }
    if (q.inputType === 'traffic_light' && val) {
      var tl = val.toLowerCase();
      if (tl !== 'green' && tl !== 'yellow' && tl !== 'red') {
        return { ok: false, message: 'Overall health must be green, yellow, or red.' };
      }
      val = tl;
    }
    if (val) {
      normalized[q.key] = val;
    }
  }
  var summary = String(normalized.executive_summary || '').trim();
  if (!summary) {
    return { ok: false, message: 'Required: Executive summary' };
  }
  return {
    ok: true,
    answers: normalized,
    executiveSummary: summary,
    trafficLight: normalized.traffic_light || null,
    questionSetVersion: ver,
  };
}
