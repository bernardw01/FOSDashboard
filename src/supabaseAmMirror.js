/**
 * PRD version 3.12.0 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Agreement Management Fibery → Supabase relational mirror (Pull / nightly).
 * Panel aggregation builders read the typed tables this mirror hydrates
 * (see `supabasePanelBuilders.js`).
 *
 * Public (integration contract; called from supabaseSyncJob.js):
 *   hydrateSupabaseAmMirror_(syncState) - processes ONE page of ONE step.
 *   resetAmMirrorCursor_(syncState)     - resets syncState.amMirror cursor.
 *
 * Does not read or write Admin Settings. Does not log secrets or full row
 * dumps.
 *
 * IMPORTANT (v3.4.1 cutover): Fibery `Agreement Management/Labor Costs` is
 * NOT mirrored by this job. Labor facts come ONLY from Clockify via
 * `labor_costs` / `fos_labor_costs` (see `fiberyUtilizationDashboard.js`,
 * `supabaseClient.js`). The legacy `fos_am_labor_costs` table (and its
 * `fos_pnl_labor_costs` junction) are deprecated and no longer written here.
 */

/** @const {string} */
var AM_MIRROR_DATASET_KEY_ = 'am-mirror';

/** @const {string} Script Property override for page size. */
var AM_MIRROR_PAGE_SIZE_PROP_ = 'AM_MIRROR_PAGE_SIZE';

/** @const {number} */
var AM_MIRROR_DEFAULT_PAGE_SIZE_ = 100;

/** @const {number} */
var AM_MIRROR_MIN_PAGE_SIZE_ = 25;

/** @const {number} */
var AM_MIRROR_MAX_PAGE_SIZE_ = 200;

/** @const {number} Rows per supabaseUpsert_ call. */
var AM_MIRROR_UPSERT_CHUNK_SIZE_ = 50;

/** @const {number} Collection subquery caps (Fibery discourages q/no-limit in subqueries). */
var AM_MIRROR_SEGMENTS_SUBQUERY_LIMIT_ = 50;
/** @const {number} */
var AM_MIRROR_ASSIGNED_RESOURCES_SUBQUERY_LIMIT_ = 200;
/** @const {number} */
var AM_MIRROR_PNL_REVENUE_SUBQUERY_LIMIT_ = 200;

/** @const {!Object<string, string>} Agreement Status enum/name -> status_key (mirrors agreementStatusUpdates.js). */
var AM_MIRROR_STATUS_KEY_BY_NAME_ = {
  'Agreement On Track': 'on_track',
  'Agreement At Risk': 'at_risk',
  'Agreement Off Trajectory': 'off_trajectory',
  'Agreement of Trajectory': 'off_trajectory',
};

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

/**
 * Enum / workflow dimension steps. Upserted into fos_am_enums
 * (onConflict: 'enum_type,fibery_id').
 * @const {!Array<!Object>}
 */
var AM_MIRROR_ENUM_STEPS_ = [
  { key: 'agreement_workflow_state', kind: 'enum', enumType: 'agreement_workflow_state', from: 'workflow/state_Agreement Management/Agreements', isWorkflow: true },
  { key: 'invoice_request_state', kind: 'enum', enumType: 'invoice_request_state', from: 'workflow/state_Agreement Management/Invoice Requests', isWorkflow: true },
  { key: 'revenue_item_state', kind: 'enum', enumType: 'revenue_item_state', from: 'workflow/state_Agreement Management/Revenue Item', isWorkflow: true },
  { key: 'agreement_progress', kind: 'enum', enumType: 'agreement_progress', from: 'Agreement Management/Agreement Progress_Revenue Management/Agreements', isWorkflow: false },
  { key: 'agreement_type', kind: 'enum', enumType: 'agreement_type', from: 'Agreement Management/Agreement Type_Revenue Management/Agreements', isWorkflow: false },
  { key: 'agreement_status', kind: 'enum', enumType: 'agreement_status', from: 'Agreement Management/Agreement Status_Agreement Management/Status Updates', isWorkflow: false },
  // NOTE: labor_approval / time_entry_status enums were only used by the
  // now-removed Fibery Labor Costs mirror step; intentionally dropped (v3.4.1).
  { key: 'clockify_company', kind: 'enum', enumType: 'clockify_company', from: 'Agreement Management/Company_Agreement Management/Clockify Users', isWorkflow: false },
  { key: 'clockify_department', kind: 'enum', enumType: 'clockify_department', from: 'Agreement Management/Department_Agreement Management/Clockify Users', isWorkflow: false },
  { key: 'work_status', kind: 'enum', enumType: 'work_status', from: 'Agreement Management/Work Status_Agreement Management/Clockify Users', isWorkflow: false },
  { key: 'funnel_stage', kind: 'enum', enumType: 'funnel_stage', from: 'Agreement Management/Funnel Stage_Revenue Management/Companies', isWorkflow: false },
  { key: 'lead_source', kind: 'enum', enumType: 'lead_source', from: 'Agreement Management/Lead Source_Revenue Management/Companies', isWorkflow: false },
  { key: 'company_segment', kind: 'enum', enumType: 'company_segment', from: 'Agreement Management/Segment_Revenue Management/Companies', isWorkflow: false },
  { key: 'odc_status', kind: 'enum', enumType: 'odc_status', from: 'Agreement Management/Status_Revenue Management/Other Direct Costs', isWorkflow: false },
  { key: 'odc_type', kind: 'enum', enumType: 'odc_type', from: 'Agreement Management/Type_Revenue Management/Other Direct Costs', isWorkflow: false },
];

/**
 * Entity steps, in dependency-friendly order (dimensions before facts).
 * @const {!Array<!Object>}
 */
var AM_MIRROR_ENTITY_STEPS_ = [
  {
    key: 'team_member_roles',
    kind: 'entity',
    table: 'fos_team_member_roles',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Team Member Roles',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'Agreement Management/Name',
      billRate: 'Agreement Management/Bill Rate',
      costRate: 'Agreement Management/Cost Rate',
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
    },
    mapRow: amMirrorMapTeamMemberRole_,
  },
  {
    key: 'companies',
    kind: 'entity',
    table: 'fos_companies',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Companies',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'Agreement Management/Name',
      website: 'Agreement Management/Website',
      qboCustomerId: 'Agreement Management/QBO Customer ID',
      companySize: 'Agreement Management/Company Size',
      marketCap: 'Agreement Management/Market Cap',
      ndaCompleted: 'Agreement Management/NDA Completed',
      stockSymbol: 'Agreement Management/Stock Symbol',
      financialBrief: 'Agreement Management/Financial Brief',
      totalContractValue: 'Agreement Management/Total Customer Contract Value',
      hqLocation: 'Agreement Management/HQ Location',
      funnelStageId: ['Agreement Management/Funnel Stage', 'fibery/id'],
      funnelStageName: ['Agreement Management/Funnel Stage', 'enum/name'],
      leadSourceId: ['Agreement Management/Lead Source', 'fibery/id'],
      leadSourceName: ['Agreement Management/Lead Source', 'enum/name'],
      accountLeadId: ['Agreement Management/Account Lead', 'fibery/id'],
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
      // Multi-select enum: path vectors return parallel id/name arrays.
      // Nested { q/from } collection subqueries fail on this workspace.
      segmentIds: ['Agreement Management/Segment', 'fibery/id'],
      segmentNames: ['Agreement Management/Segment', 'enum/name'],
    },
    mapRow: amMirrorMapCompany_,
    afterPage: amMirrorAfterCompanies_,
  },
  {
    key: 'clockify_users',
    kind: 'entity',
    table: 'fos_clockify_users',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Clockify Users',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'Agreement Management/Name',
      clockifyUserId: 'Agreement Management/Clockify User ID',
      clockifyUserEmail: 'Agreement Management/Clockify User Email',
      aiUsageTracker: 'Agreement Management/AI Usage Tracker',
      companyId: ['Agreement Management/Company', 'fibery/id'],
      companyName: ['Agreement Management/Company', 'enum/name'],
      departmentId: ['Agreement Management/Department', 'fibery/id'],
      departmentName: ['Agreement Management/Department', 'enum/name'],
      workStatusId: ['Agreement Management/Work Status', 'fibery/id'],
      workStatusName: ['Agreement Management/Work Status', 'enum/name'],
      teamMemberRoleId: ['Agreement Management/Team Member Role', 'fibery/id'],
      teamMemberRoleBillRate: 'Agreement Management/Team Member Role Bill Rate',
      teamMemberRoleCostRate: 'Agreement Management/Team Member Role Cost Rate',
      managerId: ['Agreement Management/Manager', 'fibery/id'],
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
    },
    mapRow: amMirrorMapClockifyUser_,
  },
  {
    key: 'contacts',
    kind: 'entity',
    table: 'fos_contacts',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Contacts',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'Agreement Management/Name',
      firstName: 'Agreement Management/First Name',
      lastName: 'Agreement Management/Last Name',
      email: 'Agreement Management/Email',
      cellPhone: 'Agreement Management/Cell Phone',
      role: 'Agreement Management/Role',
      linkedinUrl: 'Agreement Management/LinkedIn URL',
      birthday: 'Agreement Management/Birthday',
      location: 'Agreement Management/Location',
      companyPrimaryContact: 'Agreement Management/Company Primary Contact',
      customerId: ['Agreement Management/Customer', 'fibery/id'],
      managerId: ['Agreement Management/Manager', 'fibery/id'],
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
    },
    mapRow: amMirrorMapContact_,
  },
  {
    key: 'services_estimates',
    kind: 'entity',
    table: 'fos_services_estimates',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Services Estimate',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'Agreement Management/Name',
      companyId: ['Agreement Management/Company', 'fibery/id'],
      startDate: 'Agreement Management/Start Date',
      endDate: 'Agreement Management/End Date',
      grossMargin: 'Agreement Management/Gross Margin',
      totalRevenue: 'Agreement Management/Total Revenue',
      totalAdjustedRevenue: 'Agreement Management/Total Adjusted Revenue',
      totalTargetRevenue: 'Agreement Management/Total Target Revenue',
      totalLaborCosts: 'Agreement Management/Total Labor Costs',
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
    },
    mapRow: amMirrorMapServicesEstimate_,
  },
  {
    key: 'agreements',
    kind: 'entity',
    table: 'fos_agreements',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Agreements',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'Agreement Management/Name',
      stateId: ['workflow/state', 'fibery/id'],
      stateName: ['workflow/state', 'enum/name'],
      agreementTypeId: ['Agreement Management/Agreement Type', 'fibery/id'],
      agreementTypeName: ['Agreement Management/Agreement Type', 'enum/name'],
      agreementProgressId: ['Agreement Management/Agreement Progress', 'fibery/id'],
      agreementProgressName: ['Agreement Management/Agreement Progress', 'enum/name'],
      customerId: ['Agreement Management/Customer', 'fibery/id'],
      contactId: ['Agreement Management/Contact', 'fibery/id'],
      assignedOwnerId: ['Agreement Management/Assigned Owner', 'fibery/id'],
      customerLeadSourceId: ['Agreement Management/Customer Lead Source', 'fibery/id'],
      customerLeadSourceName: ['Agreement Management/Customer Lead Source', 'enum/name'],
      clockifyProjectId: 'Agreement Management/Clockify Project ID',
      executionDate: 'Agreement Management/Execution Date',
      duration: 'Agreement Management/Duration',
      allocatedResourceMargin: 'Agreement Management/Allocated Resource Margin',
      currentMargin: 'Agreement Management/Current Margin',
      targetMargin: 'Agreement Management/Target Margin',
      targetPlannedMarginAtComplete: 'Agreement Management/Target Planned Margin at Complete',
      targetCosts: 'Agreement Management/Target Costs',
      targetRevenue: 'Agreement Management/Target Revenue',
      revRecognized: 'Agreement Management/Rev Recognized',
      totalAllocatedLaborCosts: 'Agreement Management/Total Allocated Labor Costs',
      totalExpenses: 'Agreement Management/Total Expenses',
      totalLaborCosts: 'Agreement Management/Total Labor Costs',
      totalMaterialsOdc: 'Agreement Management/Total Materials & ODC',
      totalPlannedRevenue: 'Agreement Management/Total Planned Revenue',
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
      // Collection of Clockify Users: path vector returns id array.
      assignedResourceIds: ['Agreement Management/Assigned Resources', 'fibery/id'],
    },
    mapRow: amMirrorMapAgreement_,
    afterPage: amMirrorAfterAgreements_,
  },
  {
    key: 'resource_allocations',
    kind: 'entity',
    table: 'fos_resource_allocations',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Resource Allocations',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      allocationName: 'Agreement Management/Allocation Name',
      agreementId: ['Agreement Management/Agreement', 'fibery/id'],
      clockifyUserId: ['Agreement Management/Clockify User', 'fibery/id'],
      clockifyUserCompanyId: ['Agreement Management/Clockify User Company', 'fibery/id'],
      clockifyUserRoleId: ['Agreement Management/Clockify User Team Member Role', 'fibery/id'],
      allocatedBillable: 'Agreement Management/Allocated & Billable',
      allocatedCost: 'Agreement Management/Allocated Cost',
      allocatedHours: 'Agreement Management/Allocated Hours',
      percentAllocated: 'Agreement Management/Percent Allocated',
      workDays: 'Agreement Management/Work Days',
      notes: 'Agreement Management/Notes',
      duration: 'Agreement Management/Duration',
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
    },
    mapRow: amMirrorMapResourceAllocation_,
  },
  {
    key: 'estimated_allocations',
    kind: 'entity',
    table: 'fos_estimated_allocations',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Estimated Allocations',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'Agreement Management/Name',
      servicesEstimateId: ['Agreement Management/Services Estimate', 'fibery/id'],
      clockifyUserId: ['Agreement Management/Clockify User', 'fibery/id'],
      genericResourceId: ['Agreement Management/Generic Resource', 'fibery/id'],
      allocatedHours: 'Agreement Management/Allocated Hours',
      // Fibery field is Percent Allocated (no field named Allocation).
      allocation: 'Agreement Management/Percent Allocated',
      allocationCostGeneric: 'Agreement Management/Allocation Cost (Generic)',
      adjustedRevenue: 'Agreement Management/Adjusted Revenue',
      billRateAdjustment: 'Agreement Management/Bill Rate Adjustement',
      genericResourceBillRate: 'Agreement Management/Generic Resource Bill Rate',
      plannedBillRate: 'Agreement Management/Planned Bill Rate',
      toBeHired: 'Agreement Management/To Be Hired',
      duration: 'Agreement Management/Duration',
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
    },
    mapRow: amMirrorMapEstimatedAllocation_,
  },
  {
    key: 'other_direct_costs',
    kind: 'entity',
    table: 'fos_other_direct_costs',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Other Direct Costs',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'Agreement Management/Name',
      agreementId: ['Agreement Management/Engagement', 'fibery/id'],
      amount: 'Agreement Management/Amount',
      billRate: 'Agreement Management/Bill Rate',
      costRate: 'Agreement Management/Cost Rate',
      hours: 'Agreement Management/Hours',
      costDate: 'Agreement Management/Date',
      statusId: ['Agreement Management/Status', 'fibery/id'],
      statusName: ['Agreement Management/Status', 'enum/name'],
      typeId: ['Agreement Management/Type', 'fibery/id'],
      typeName: ['Agreement Management/Type', 'enum/name'],
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
    },
    mapRow: amMirrorMapOtherDirectCost_,
  },
  {
    key: 'invoice_requests',
    kind: 'entity',
    table: 'fos_invoice_requests',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Invoice Requests',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'Agreement Management/Name',
      agreementId: ['Agreement Management/Agreement', 'fibery/id'],
      stateId: ['workflow/state', 'fibery/id'],
      stateName: ['workflow/state', 'enum/name'],
      qboInvoiceNumber: 'Agreement Management/QBO Invoice Number',
      qboInvoiceStatus: 'Agreement Management/QBO Invoice Status',
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
    },
    mapRow: amMirrorMapInvoiceRequest_,
  },
  {
    key: 'status_updates',
    kind: 'entity',
    table: 'fos_status_updates',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Status Updates',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'Agreement Management/Name',
      agreementId: ['Agreement Management/Agreement', 'fibery/id'],
      agreementStatusId: ['Agreement Management/Agreement Status', 'fibery/id'],
      agreementStatusName: ['Agreement Management/Agreement Status', 'enum/name'],
      submittedBy: 'Agreement Management/Submitted by',
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
    },
    mapRow: amMirrorMapStatusUpdate_,
  },
  {
    key: 'revenue_items',
    kind: 'entity',
    table: 'fos_revenue_items',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Revenue Item',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'Agreement Management/Name',
      agreementId: ['Agreement Management/Agreement', 'fibery/id'],
      invoiceRequestId: ['Agreement Management/Invoice Request', 'fibery/id'],
      agreementCustomerId: ['Agreement Management/Agreement Customer', 'fibery/id'],
      agreementTypeId: ['Agreement Management/Agreement Type', 'fibery/id'],
      agreementTypeName: ['Agreement Management/Agreement Type', 'enum/name'],
      customerLeadSourceId: ['Agreement Management/Agreement Customer Lead Source', 'fibery/id'],
      stateId: ['workflow/state', 'fibery/id'],
      stateName: ['workflow/state', 'enum/name'],
      milestoneTitle: 'Agreement Management/Milestone Title',
      targetAmount: 'Agreement Management/Target Amount',
      actualAmount: 'Agreement Management/Actual Amount',
      amountVariance: 'Agreement Management/Amount Variance',
      targetDate: 'Agreement Management/Target Date',
      actualDate: 'Agreement Management/Actual Date',
      targetMonth: 'Agreement Management/Target Month',
      revenueRecognized: 'Agreement Management/Revenue Recognized',
      qboInvoiceId: 'Agreement Management/QBO Invoice ID',
      qboInvoiceUrl: 'Agreement Management/QBO Invoice URL',
      invoiceError: 'Agreement Management/Invoice Error',
      notes: 'Agreement Management/notes',
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
    },
    mapRow: amMirrorMapRevenueItem_,
  },
  {
    key: 'agreement_pnl_items',
    kind: 'entity',
    table: 'fos_agreement_pnl_items',
    onConflict: 'fibery_id',
    from: 'Agreement Management/Agreement P and L Items',
    select: {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      agreementId: ['Agreement Management/Agreement', 'fibery/id'],
      agreementName: 'Agreement Management/Agreement Name',
      agreementTypeId: ['Agreement Management/Agreement Agreement Type', 'fibery/id'],
      monthYear: 'Agreement Management/Month-Year',
      pnlMonthYear: 'Agreement Management/P&L Month-Year',
      duration: 'Agreement Management/P-L Duration',
      contractorCogs: 'Agreement Management/Contractor COGS',
      employeeCogs: 'Agreement Management/Employee COGS',
      durationCosts: 'Agreement Management/Duration Costs',
      durationOdc: 'Agreement Management/Duration ODC',
      durationRevenue: 'Agreement Management/Duration Revenue',
      marginAmount: 'Agreement Management/Margin $',
      marginPct: 'Agreement Management/Margin %',
      createdAt: 'fibery/creation-date',
      modifiedAt: 'fibery/modification-date',
      // NOTE: no labor collection here - Fibery Labor Costs are not mirrored.
      // Revenue item junctions use a path vector (id array).
      revenueItemIds: ['Agreement Management/Agreement Revenue Items', 'fibery/id'],
    },
    mapRow: amMirrorMapAgreementPnlItem_,
    afterPage: amMirrorAfterPnlItems_,
  },
];

/**
 * Full ordered step list: enum dimensions first, then entity facts.
 * @const {!Array<!Object>}
 */
var AM_MIRROR_STEPS_ = AM_MIRROR_ENUM_STEPS_.concat(AM_MIRROR_ENTITY_STEPS_);

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Processes ONE page of ONE Agreement Management mirror step. Designed to be
 * called repeatedly (e.g. from a Supabase sync continuation batch) until it
 * returns `continue: false`.
 *
 * @param {!Object} syncState Mutable running sync state from
 *   readSupabaseSyncState_(). Uses/creates syncState.amMirror as the cursor.
 * @return {!{ ok: true, continue: boolean, detail: string }|
 *          !{ ok: false, message: string }}
 */
function hydrateSupabaseAmMirror_(syncState) {
  if (!syncState || typeof syncState !== 'object') {
    return { ok: false, message: 'AM mirror hydrate called without a sync state object.' };
  }
  if (!isSupabaseConfigured_()) {
    return { ok: false, message: 'Supabase is not configured.' };
  }
  if (
    !syncState.amMirror ||
    typeof syncState.amMirror.stepIndex !== 'number' ||
    typeof syncState.amMirror.offset !== 'number'
  ) {
    resetAmMirrorCursor_(syncState);
  }

  var cursor = syncState.amMirror;
  if (cursor.stepIndex < 0 || cursor.stepIndex >= AM_MIRROR_STEPS_.length) {
    syncState.amMirror = null;
    return { ok: true, continue: false, detail: 'Agreement Management mirror already complete.' };
  }

  var step = AM_MIRROR_STEPS_[cursor.stepIndex];
  var pageSize = amMirrorPageSize_();
  var select = amMirrorSelectForStep_(step);
  if (!select) {
    return { ok: false, message: 'AM mirror step "' + step.key + '" has no select map.' };
  }
  var page = amMirrorFetchPage_(step.from, select, pageSize, cursor.offset);
  if (!page.ok) {
    return {
      ok: false,
      message: 'AM mirror step "' + step.key + '" fetch failed: ' + (page.message || page.reason || 'unknown error'),
    };
  }

  var rows = page.rows || [];
  if (!rows.length) {
    cursor.stepIndex++;
    cursor.offset = 0;
    var doneAfterEmpty = cursor.stepIndex >= AM_MIRROR_STEPS_.length;
    if (doneAfterEmpty) {
      syncState.amMirror = null;
    }
    return {
      ok: true,
      continue: !doneAfterEmpty,
      detail: 'step complete: ' + step.key + ' (0 rows on final page)',
    };
  }

  var processed;
  try {
    processed = amMirrorProcessStep_(step, rows);
  } catch (e) {
    return {
      ok: false,
      message: 'AM mirror step "' + step.key + '" failed: ' + (e && e.message ? e.message : String(e)),
    };
  }
  if (!processed.ok) {
    return { ok: false, message: processed.message || ('AM mirror step "' + step.key + '" upsert failed.') };
  }

  cursor.offset += rows.length;
  var pageWasShort = rows.length < pageSize;
  if (pageWasShort) {
    cursor.stepIndex++;
    cursor.offset = 0;
  }
  var allDone = cursor.stepIndex >= AM_MIRROR_STEPS_.length;
  if (allDone) {
    syncState.amMirror = null;
  }
  return {
    ok: true,
    continue: !allDone,
    detail: step.key + ': ' + rows.length + ' row(s)' + (pageWasShort ? ' (step complete)' : ''),
  };
}

/**
 * Resets the Agreement Management mirror cursor to the beginning.
 * @param {!Object} syncState
 */
function resetAmMirrorCursor_(syncState) {
  if (syncState && typeof syncState === 'object') {
    syncState.amMirror = { stepIndex: 0, offset: 0 };
  }
}

// ---------------------------------------------------------------------------
// Step processing
// ---------------------------------------------------------------------------

/**
 * @param {!Object} step
 * @param {!Array<!Object>} rows Raw Fibery rows for this page.
 * @return {!{ ok: true }|!{ ok: false, message: string }}
 * @private
 */
function amMirrorProcessStep_(step, rows) {
  if (step.kind === 'enum') {
    return amMirrorProcessEnumStep_(step, rows);
  }
  return amMirrorProcessEntityStep_(step, rows);
}

/**
 * @param {!Object} step
 * @param {!Array<!Object>} rows
 * @return {!{ ok: true }|!{ ok: false, message: string }}
 * @private
 */
function amMirrorProcessEnumStep_(step, rows) {
  var mapped = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row || !row.id) continue;
    mapped.push({
      enum_type: step.enumType,
      fibery_id: row.id,
      public_id: row.publicId || null,
      name: row.name || null,
      color: row.color || null,
      is_final: step.isWorkflow ? amMirrorBool_(row.final) : null,
      workflow_type: step.isWorkflow ? (row.type || null) : null,
      rank: amMirrorNum_(row.rank),
      created_at: amMirrorDate_(row.createdAt),
      synced_at: amMirrorNowIso_(),
      raw: row,
    });
  }
  if (!mapped.length) {
    return { ok: true };
  }
  return amMirrorUpsertChunks_('fos_am_enums', mapped, 'enum_type,fibery_id');
}

/**
 * @param {!Object} step
 * @param {!Array<!Object>} rows
 * @return {!{ ok: true }|!{ ok: false, message: string }}
 * @private
 */
function amMirrorProcessEntityStep_(step, rows) {
  var mapped = [];
  for (var i = 0; i < rows.length; i++) {
    var mappedRow = step.mapRow(rows[i]);
    if (mappedRow) {
      mapped.push(mappedRow);
    }
  }
  if (mapped.length) {
    var res = amMirrorUpsertChunks_(step.table, mapped, step.onConflict);
    if (!res.ok) {
      return res;
    }
  }
  if (step.afterPage) {
    try {
      step.afterPage(mapped, rows);
    } catch (e) {
      supabaseWarn_('amMirror afterPage failed for ' + step.key, e);
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// afterPage: M2M junction upserts (best-effort; do not fail the page)
// ---------------------------------------------------------------------------

/**
 * @param {!Array<!Object>} mappedRows
 * @param {!Array<!Object>} fiberyRows
 * @private
 */
function amMirrorAfterCompanies_(mappedRows, fiberyRows) {
  var junctions = [];
  for (var i = 0; i < fiberyRows.length; i++) {
    var row = fiberyRows[i];
    if (!row || !row.id) continue;
    var ids = Array.isArray(row.segmentIds) ? row.segmentIds : [];
    var names = Array.isArray(row.segmentNames) ? row.segmentNames : [];
    for (var j = 0; j < ids.length; j++) {
      if (!ids[j]) continue;
      junctions.push({
        company_fibery_id: row.id,
        segment_fibery_id: ids[j],
        segment_name: names[j] || null,
      });
    }
  }
  if (junctions.length) {
    amMirrorUpsertChunks_('fos_company_segments', junctions, 'company_fibery_id,segment_fibery_id');
  }
}

/**
 * @param {!Array<!Object>} mappedRows
 * @param {!Array<!Object>} fiberyRows
 * @private
 */
function amMirrorAfterAgreements_(mappedRows, fiberyRows) {
  var junctions = [];
  for (var i = 0; i < fiberyRows.length; i++) {
    var row = fiberyRows[i];
    if (!row || !row.id) continue;
    var ids = Array.isArray(row.assignedResourceIds) ? row.assignedResourceIds : [];
    for (var j = 0; j < ids.length; j++) {
      if (!ids[j]) continue;
      junctions.push({
        agreement_fibery_id: row.id,
        clockify_user_fibery_id: ids[j],
      });
    }
  }
  if (junctions.length) {
    amMirrorUpsertChunks_('fos_agreement_assigned_resources', junctions, 'agreement_fibery_id,clockify_user_fibery_id');
  }
}

/**
 * Writes revenue-item junctions only. Fibery Labor Costs are not mirrored
 * (v3.4.1), so `fos_pnl_labor_costs` is intentionally never written here.
 *
 * @param {!Array<!Object>} mappedRows
 * @param {!Array<!Object>} fiberyRows
 * @private
 */
function amMirrorAfterPnlItems_(mappedRows, fiberyRows) {
  var revenueJunctions = [];
  for (var i = 0; i < fiberyRows.length; i++) {
    var row = fiberyRows[i];
    if (!row || !row.id) continue;
    var ids = Array.isArray(row.revenueItemIds) ? row.revenueItemIds : [];
    for (var k = 0; k < ids.length; k++) {
      if (!ids[k]) continue;
      revenueJunctions.push({
        pnl_fibery_id: row.id,
        revenue_item_fibery_id: ids[k],
      });
    }
  }
  if (revenueJunctions.length) {
    amMirrorUpsertChunks_('fos_pnl_revenue_items', revenueJunctions, 'pnl_fibery_id,revenue_item_fibery_id');
  }
}

// ---------------------------------------------------------------------------
// mapRow implementations
// ---------------------------------------------------------------------------

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapTeamMemberRole_(row) {
  if (!row || !row.id) return null;
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    name: row.name || null,
    bill_rate: amMirrorNum_(row.billRate),
    cost_rate: amMirrorNum_(row.costRate),
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: row,
  };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapCompany_(row) {
  if (!row || !row.id) return null;
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    name: row.name || null,
    website: row.website || null,
    qbo_customer_id: row.qboCustomerId || null,
    company_size: amMirrorNum_(row.companySize),
    market_cap: amMirrorNum_(row.marketCap),
    nda_completed: amMirrorBool_(row.ndaCompleted),
    stock_symbol: row.stockSymbol || null,
    financial_brief: row.financialBrief || null,
    total_customer_contract_value: amMirrorNum_(row.totalContractValue),
    hq_location: row.hqLocation || null,
    funnel_stage_id: amMirrorRelId_(row.funnelStageId),
    funnel_stage_name: row.funnelStageName || null,
    lead_source_id: amMirrorRelId_(row.leadSourceId),
    lead_source_name: row.leadSourceName || null,
    account_lead_id: amMirrorRelId_(row.accountLeadId),
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: amMirrorRawWithout_(row, ['segmentIds', 'segmentNames']),
  };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapClockifyUser_(row) {
  if (!row || !row.id) return null;
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    name: row.name || null,
    clockify_user_id: row.clockifyUserId || null,
    clockify_user_email: row.clockifyUserEmail || null,
    ai_usage_tracker: amMirrorBool_(row.aiUsageTracker),
    company_enum_id: amMirrorRelId_(row.companyId),
    company_enum_name: row.companyName || null,
    department_id: amMirrorRelId_(row.departmentId),
    department_name: row.departmentName || null,
    work_status_id: amMirrorRelId_(row.workStatusId),
    work_status_name: row.workStatusName || null,
    team_member_role_id: amMirrorRelId_(row.teamMemberRoleId),
    team_member_role_bill_rate: amMirrorNum_(row.teamMemberRoleBillRate),
    team_member_role_cost_rate: amMirrorNum_(row.teamMemberRoleCostRate),
    manager_id: amMirrorRelId_(row.managerId),
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: row,
  };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapContact_(row) {
  if (!row || !row.id) return null;
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    name: row.name || null,
    first_name: row.firstName || null,
    last_name: row.lastName || null,
    email: row.email || null,
    cell_phone: row.cellPhone || null,
    role: row.role || null,
    linkedin_url: row.linkedinUrl || null,
    birthday: amMirrorDate_(row.birthday),
    location: row.location || null,
    company_primary_contact: amMirrorBool_(row.companyPrimaryContact),
    customer_id: amMirrorRelId_(row.customerId),
    manager_id: amMirrorRelId_(row.managerId),
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: row,
  };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapServicesEstimate_(row) {
  if (!row || !row.id) return null;
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    name: row.name || null,
    company_id: amMirrorRelId_(row.companyId),
    start_date: amMirrorDate_(row.startDate),
    end_date: amMirrorDate_(row.endDate),
    gross_margin: amMirrorNum_(row.grossMargin),
    total_revenue: amMirrorNum_(row.totalRevenue),
    total_adjusted_revenue: amMirrorNum_(row.totalAdjustedRevenue),
    total_target_revenue: amMirrorNum_(row.totalTargetRevenue),
    total_labor_costs: amMirrorNum_(row.totalLaborCosts),
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: row,
  };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapAgreement_(row) {
  if (!row || !row.id) return null;
  var dur = amMirrorDateRange_(row.duration);
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    name: row.name || null,
    status: row.stateName || null,
    agreement_type: row.agreementTypeName || null,
    company_fibery_id: amMirrorRelId_(row.customerId),
    customer_id: amMirrorRelId_(row.customerId),
    contact_id: amMirrorRelId_(row.contactId),
    assigned_owner_id: amMirrorRelId_(row.assignedOwnerId),
    state_id: amMirrorRelId_(row.stateId),
    state_name: row.stateName || null,
    agreement_type_id: amMirrorRelId_(row.agreementTypeId),
    agreement_progress_id: amMirrorRelId_(row.agreementProgressId),
    agreement_progress_name: row.agreementProgressName || null,
    customer_lead_source_id: amMirrorRelId_(row.customerLeadSourceId),
    customer_lead_source_name: row.customerLeadSourceName || null,
    clockify_project_id: row.clockifyProjectId || null,
    execution_date: amMirrorDate_(row.executionDate),
    duration_start: dur.start,
    duration_end: dur.end,
    allocated_resource_margin: amMirrorNum_(row.allocatedResourceMargin),
    current_margin: amMirrorNum_(row.currentMargin),
    target_margin: amMirrorNum_(row.targetMargin),
    target_planned_margin_at_complete: amMirrorNum_(row.targetPlannedMarginAtComplete),
    target_costs: amMirrorNum_(row.targetCosts),
    target_revenue: amMirrorNum_(row.targetRevenue),
    rev_recognized: amMirrorNum_(row.revRecognized),
    total_allocated_labor_costs: amMirrorNum_(row.totalAllocatedLaborCosts),
    total_expenses: amMirrorNum_(row.totalExpenses),
    total_labor_costs: amMirrorNum_(row.totalLaborCosts),
    total_materials_odc: amMirrorNum_(row.totalMaterialsOdc),
    total_planned_revenue: amMirrorNum_(row.totalPlannedRevenue),
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: amMirrorRawWithout_(row, ['assignedResourceIds']),
  };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapResourceAllocation_(row) {
  if (!row || !row.id) return null;
  var dur = amMirrorDateRange_(row.duration);
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    allocation_name: row.allocationName || null,
    agreement_id: amMirrorRelId_(row.agreementId),
    clockify_user_id: amMirrorRelId_(row.clockifyUserId),
    clockify_user_company_id: amMirrorRelId_(row.clockifyUserCompanyId),
    clockify_user_role_id: amMirrorRelId_(row.clockifyUserRoleId),
    allocated_billable: amMirrorBool_(row.allocatedBillable),
    allocated_cost: amMirrorNum_(row.allocatedCost),
    allocated_hours: amMirrorNum_(row.allocatedHours),
    percent_allocated: amMirrorNum_(row.percentAllocated),
    work_days: amMirrorNum_(row.workDays),
    notes: row.notes || null,
    duration_start: dur.start,
    duration_end: dur.end,
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: row,
  };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapEstimatedAllocation_(row) {
  if (!row || !row.id) return null;
  var dur = amMirrorDateRange_(row.duration);
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    name: row.name || null,
    services_estimate_id: amMirrorRelId_(row.servicesEstimateId),
    clockify_user_id: amMirrorRelId_(row.clockifyUserId),
    generic_resource_id: amMirrorRelId_(row.genericResourceId),
    allocated_hours: amMirrorNum_(row.allocatedHours),
    allocation: amMirrorNum_(row.allocation),
    allocation_cost_generic: amMirrorNum_(row.allocationCostGeneric),
    adjusted_revenue: amMirrorNum_(row.adjustedRevenue),
    bill_rate_adjustment: amMirrorNum_(row.billRateAdjustment),
    generic_resource_bill_rate: amMirrorNum_(row.genericResourceBillRate),
    planned_bill_rate: amMirrorNum_(row.plannedBillRate),
    to_be_hired: amMirrorBool_(row.toBeHired),
    duration_start: dur.start,
    duration_end: dur.end,
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: row,
  };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapOtherDirectCost_(row) {
  if (!row || !row.id) return null;
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    name: row.name || null,
    agreement_id: amMirrorRelId_(row.agreementId),
    amount: amMirrorNum_(row.amount),
    bill_rate: amMirrorNum_(row.billRate),
    cost_rate: amMirrorNum_(row.costRate),
    hours: amMirrorNum_(row.hours),
    cost_date: amMirrorDate_(row.costDate),
    status_id: amMirrorRelId_(row.statusId),
    status_name: row.statusName || null,
    type_id: amMirrorRelId_(row.typeId),
    type_name: row.typeName || null,
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: row,
  };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapInvoiceRequest_(row) {
  if (!row || !row.id) return null;
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    name: row.name || null,
    agreement_id: amMirrorRelId_(row.agreementId),
    state_id: amMirrorRelId_(row.stateId),
    state_name: row.stateName || null,
    qbo_invoice_number: row.qboInvoiceNumber || null,
    qbo_invoice_status: row.qboInvoiceStatus || null,
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: row,
  };
}

/**
 * Only sets fields we have; author_email/content (feature 018 dual-write
 * columns) are intentionally omitted so this mirror never wipes them.
 *
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapStatusUpdate_(row) {
  if (!row || !row.id) return null;
  var agreementId = amMirrorRelId_(row.agreementId);
  if (!agreementId) return null;
  var statusName = row.agreementStatusName || null;
  return {
    fibery_id: row.id,
    agreement_id: agreementId,
    public_id: row.publicId || null,
    name: row.name || null,
    agreement_status_id: amMirrorRelId_(row.agreementStatusId),
    status_key: statusName ? (AM_MIRROR_STATUS_KEY_BY_NAME_[statusName] || null) : null,
    status_label: statusName,
    submitted_by: row.submittedBy || null,
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: row,
  };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapRevenueItem_(row) {
  if (!row || !row.id) return null;
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    name: row.name || null,
    agreement_id: amMirrorRelId_(row.agreementId),
    invoice_request_id: amMirrorRelId_(row.invoiceRequestId),
    agreement_customer_id: amMirrorRelId_(row.agreementCustomerId),
    agreement_type_id: amMirrorRelId_(row.agreementTypeId),
    agreement_type_name: row.agreementTypeName || null,
    customer_lead_source_id: amMirrorRelId_(row.customerLeadSourceId),
    state_id: amMirrorRelId_(row.stateId),
    state_name: row.stateName || null,
    milestone_title: row.milestoneTitle || null,
    target_amount: amMirrorNum_(row.targetAmount),
    actual_amount: amMirrorNum_(row.actualAmount),
    amount_variance: amMirrorNum_(row.amountVariance),
    target_date: amMirrorDate_(row.targetDate),
    actual_date: amMirrorDate_(row.actualDate),
    target_month: row.targetMonth || null,
    revenue_recognized: amMirrorBool_(row.revenueRecognized),
    qbo_invoice_id: row.qboInvoiceId || null,
    qbo_invoice_url: row.qboInvoiceUrl || null,
    invoice_error: row.invoiceError || null,
    notes: row.notes || null,
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: row,
  };
}

/**
 * @param {!Object} row
 * @return {?Object}
 * @private
 */
function amMirrorMapAgreementPnlItem_(row) {
  if (!row || !row.id) return null;
  var dur = amMirrorDateRange_(row.duration);
  return {
    fibery_id: row.id,
    public_id: row.publicId || null,
    agreement_id: amMirrorRelId_(row.agreementId),
    agreement_name: row.agreementName || null,
    agreement_type_id: amMirrorRelId_(row.agreementTypeId),
    month_year: row.monthYear || null,
    pnl_month_year: row.pnlMonthYear || null,
    duration_start: dur.start,
    duration_end: dur.end,
    contractor_cogs: amMirrorNum_(row.contractorCogs),
    employee_cogs: amMirrorNum_(row.employeeCogs),
    duration_costs: amMirrorNum_(row.durationCosts),
    duration_odc: amMirrorNum_(row.durationOdc),
    duration_revenue: amMirrorNum_(row.durationRevenue),
    margin_amount: amMirrorNum_(row.marginAmount),
    margin_pct: amMirrorNum_(row.marginPct),
    created_at: amMirrorDate_(row.createdAt),
    modified_at: amMirrorDate_(row.modifiedAt),
    synced_at: amMirrorNowIso_(),
    raw: amMirrorRawWithout_(row, ['laborCosts', 'revenueItems', 'revenueItemIds']),
  };
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/** @return {string} */
function amMirrorNowIso_() {
  return new Date().toISOString();
}

/**
 * Normalizes a Fibery relation value to a bare fibery/id string.
 * Handles dereferenced scalars (already a string), bare relation objects
 * (`{ 'fibery/id': ... }` or `{ id: ... }`), and empty relations.
 *
 * @param {*} val
 * @return {?string}
 */
function amMirrorRelId_(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    var s = val.trim();
    return s.length ? s : null;
  }
  if (typeof val === 'object') {
    if (val['fibery/id']) return String(val['fibery/id']);
    if (val.id) return String(val.id);
  }
  return null;
}

/**
 * Normalizes a Fibery date / date-time value to an ISO string.
 * @param {*} val
 * @return {?string}
 */
function amMirrorDate_(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') {
    var s = val.trim();
    return s.length ? s : null;
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  return null;
}

/**
 * Unpacks a Fibery date-range field (`{ start, end }`) into ISO start/end.
 * @param {*} val
 * @return {!{ start: ?string, end: ?string }}
 */
function amMirrorDateRange_(val) {
  if (!val || typeof val !== 'object') {
    return { start: null, end: null };
  }
  return {
    start: amMirrorDate_(val.start),
    end: amMirrorDate_(val.end),
  };
}

/**
 * @param {*} val
 * @return {?number}
 */
function amMirrorNum_(val) {
  if (val === null || val === undefined || val === '') return null;
  var n = Number(val);
  return isFinite(n) ? n : null;
}

/**
 * @param {*} val
 * @return {?boolean}
 */
function amMirrorBool_(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    var s = val.trim().toLowerCase();
    if (s === 'true' || s === 'yes' || s === '1') return true;
    if (s === 'false' || s === 'no' || s === '0') return false;
    return null;
  }
  return !!val;
}

/**
 * Reads AM_MIRROR_PAGE_SIZE (Script Property, optional), clamped 25-200.
 * @return {number}
 */
function amMirrorPageSize_() {
  var raw = PropertiesService.getScriptProperties().getProperty(AM_MIRROR_PAGE_SIZE_PROP_);
  var n = parseInt(raw, 10);
  if (!raw || isNaN(n)) {
    n = AM_MIRROR_DEFAULT_PAGE_SIZE_;
  }
  if (n < AM_MIRROR_MIN_PAGE_SIZE_) n = AM_MIRROR_MIN_PAGE_SIZE_;
  if (n > AM_MIRROR_MAX_PAGE_SIZE_) n = AM_MIRROR_MAX_PAGE_SIZE_;
  return n;
}

/**
 * Upserts rows to Supabase in chunks of AM_MIRROR_UPSERT_CHUNK_SIZE_.
 * @param {string} table
 * @param {!Array<!Object>} rows
 * @param {string} onConflict
 * @return {!{ ok: true }|!{ ok: false, message: string }}
 */
function amMirrorUpsertChunks_(table, rows, onConflict) {
  if (!rows || !rows.length) {
    return { ok: true };
  }
  for (var i = 0; i < rows.length; i += AM_MIRROR_UPSERT_CHUNK_SIZE_) {
    var chunk = rows.slice(i, i + AM_MIRROR_UPSERT_CHUNK_SIZE_);
    var res = supabaseUpsert_(table, chunk, onConflict);
    if (!res.ok) {
      supabaseWarn_('amMirror upsert failed for ' + table, { message: res.message });
      return { ok: false, message: 'Upsert to ' + table + ' failed: ' + (res.message || 'unknown error') };
    }
  }
  return { ok: true };
}

/**
 * Builds the Fibery `q/select` map for a mirror step (enum or entity).
 * @param {!Object} step
 * @return {?Object}
 */
function amMirrorSelectForStep_(step) {
  if (!step) return null;
  if (step.kind === 'enum') {
    var sel = {
      id: 'fibery/id',
      publicId: 'fibery/public-id',
      name: 'enum/name',
      color: 'enum/color',
      rank: 'fibery/rank',
      createdAt: 'fibery/creation-date',
    };
    if (step.isWorkflow) {
      sel.final = 'workflow/Final';
      sel.type = 'workflow/Type';
    }
    return sel;
  }
  return step.select || null;
}

/**
 * Fetches one page of a Fibery database, ordered by creation date ascending
 * for stable pagination.
 *
 * @param {string} from `q/from` database name.
 * @param {!Object} select `q/select` map.
 * @param {number} limit
 * @param {number} offset
 * @return {!{ ok: true, rows: !Array }|!{ ok: false, reason: string, message: string }}
 */
function amMirrorFetchPage_(from, select, limit, offset) {
  return fiberyQuery_({
    'q/from': from,
    'q/select': select,
    'q/limit': limit,
    'q/offset': offset,
    'q/order-by': [[['fibery/creation-date'], 'q/asc']],
  });
}

/**
 * Shallow-copies an object, omitting the given keys. Used to keep `raw`
 * columns free of large collection subquery results.
 *
 * @param {!Object} row
 * @param {!Array<string>} keys
 * @return {!Object}
 */
function amMirrorRawWithout_(row, keys) {
  if (!row || typeof row !== 'object') return row;
  var copy = {};
  for (var k in row) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
    if (keys && keys.indexOf(k) !== -1) continue;
    copy[k] = row[k];
  }
  return copy;
}
