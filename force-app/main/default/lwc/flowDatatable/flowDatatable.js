import { LightningElement, api, wire } from 'lwc';
import { FlowAttributeChangeEvent } from 'lightning/flowSupport';
import { NavigationMixin } from 'lightning/navigation';
import getColumnMetadata from '@salesforce/apex/FlowDatatableService.getColumnMetadata';

const SELECTION_VIEW_ONLY = 'View Only';
const SELECTION_SINGLE = 'Single Select';
const SELECTION_MULTI = 'Multi Select';

export default class FlowDatatable extends NavigationMixin(LightningElement) {
    // ─────────────────────────────────────────────────────────────────
    // Flow inputs
    // ─────────────────────────────────────────────────────────────────
    @api records = [];
    @api objectApiName = '';
    @api fieldNames = 'Name';
    @api columnLabels = '';
    @api editableFields = '';
    @api selectionMode = SELECTION_VIEW_ONLY;
    @api enableInlineEdit = false;
    @api visibleRows = 10;
    @api showSearch = false;
    @api headerText = '';
    @api showRowNumbers = false;
    @api headerFontSize = '12';
    @api rowFontSize = '13';

    // Flow outputs
    @api selectedRecords = [];
    @api editedRecords = [];
    @api selectedCount = 0;

    // ─────────────────────────────────────────────────────────────────
    // Internal state
    // ─────────────────────────────────────────────────────────────────
    _selectedIds = new Set();
    _editedRecordMap = new Map();
    _searchTerm = '';
    _columnMetadata = [];
    _metadataLoaded = false;
    _metadataError = null;
    _editingCell = null; // { recordId, fieldName }
    _tabNavigating = false;
    _sortField = null;
    _sortDirection = 'asc'; // 'asc' or 'desc'
    _appliedVisibleRows = null;

    // ─────────────────────────────────────────────────────────────────
    // Wire: Fetch column metadata from Apex
    // ─────────────────────────────────────────────────────────────────
    @wire(getColumnMetadata, {
        objectApiName: '$objectApiName',
        fieldNames: '$fieldNames'
    })
    wiredMetadata({ error, data }) {
        if (data) {
            this._columnMetadata = data;
            this._metadataLoaded = true;
            this._metadataError = null;
        } else if (error) {
            this._metadataError = this.normalizeError(error);
            this._metadataLoaded = true;
        }
    }

    connectedCallback() {
        this.initializeSelections();
    }

    renderedCallback() {
        if (this._metadataLoaded && this.hasRecords && this.visibleRows !== this._appliedVisibleRows) {
            this._adjustTableHeight();
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Computed properties
    // ─────────────────────────────────────────────────────────────────

    get isViewOnly() {
        return this.selectionMode === SELECTION_VIEW_ONLY;
    }

    get isSingleSelect() {
        return this.selectionMode === SELECTION_SINGLE;
    }

    get isMultiSelect() {
        return this.selectionMode === SELECTION_MULTI;
    }

    get isSelectable() {
        return this.isSingleSelect || this.isMultiSelect;
    }

    get canInlineEdit() {
        return this.enableInlineEdit;
    }

    get hasRecords() {
        return this.safeRecords && this.safeRecords.length > 0;
    }

    get safeRecords() {
        if (!this.records || !Array.isArray(this.records)) {
            return [];
        }
        return this.records;
    }

    get hasHeader() {
        return this.headerText && this.headerText.trim().length > 0;
    }

    get showSearchBar() {
        return this.showSearch && this.hasRecords;
    }

    get tableContainerStyle() {
        const hSize = this.headerFontSize || '12';
        const rSize = this.rowFontSize || '13';
        return `--header-font-size:${hSize}px;--row-font-size:${rSize}px`;
    }

    _adjustTableHeight() {
        const container = this.template.querySelector('.table-container');
        if (!container) return;

        const thead = container.querySelector('thead');
        const firstRow = container.querySelector('tbody tr');
        if (!thead || !firstRow) return;

        const headerHeight = thead.offsetHeight;
        const rowHeight = firstRow.offsetHeight;
        const maxHeight = headerHeight + (this.visibleRows * rowHeight);

        container.style.maxHeight = maxHeight + 'px';
        this._appliedVisibleRows = this.visibleRows;
    }

    get isAllSelected() {
        if (!this.isMultiSelect || !this.hasRecords) return false;
        return this.safeRecords.every(r => r && r.Id && this._selectedIds.has(r.Id));
    }

    get searchPlaceholder() {
        return 'Search table...';
    }

    get resultCountText() {
        const filtered = this.processedRows.length;
        const total = this.safeRecords.length;
        if (this._searchTerm && filtered !== total) {
            return `Showing ${filtered} of ${total}`;
        }
        return '';
    }

    // ─────────────────────────────────────────────────────────────────
    // Column processing
    // ─────────────────────────────────────────────────────────────────

    get _editableFieldSet() {
        if (!this.editableFields) return new Set();
        return new Set(this.editableFields.split(',').map(f => f.trim()).filter(f => f));
    }

    get processedColumns() {
        if (!this._columnMetadata || this._columnMetadata.length === 0) {
            return [];
        }

        const customLabels = this.columnLabels
            ? this.columnLabels.split(',').map(l => l.trim())
            : [];
        const editableSet = this._editableFieldSet;

        return this._columnMetadata.map((col, index) => {
            const label = customLabels[index] || col.label || col.fieldApiName;
            const isSorted = this._sortField === col.fieldApiName;
            let sortIcon = 'utility:arrowdown';
            let sortClass = 'sort-icon sort-icon-hidden';
            if (isSorted) {
                sortIcon = this._sortDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown';
                sortClass = 'sort-icon';
            }

            // A field is editable if: inline edit is on, it's in the editableFields list
            // (or editableFields is empty = all editable fields allowed), and it's not a relationship
            const isFieldEditable = this.canInlineEdit &&
                col.isEditable &&
                !col.isRelationship &&
                (editableSet.size === 0 || editableSet.has(col.fieldApiName));

            return {
                key: `col-${index}`,
                fieldApiName: col.fieldApiName,
                label: label,
                dataType: col.dataType,
                isEditable: isFieldEditable,
                isRelationship: col.isRelationship,
                relationshipIdField: col.relationshipIdField,
                picklistValues: col.picklistValues,
                isSorted: isSorted,
                sortIcon: sortIcon,
                sortClass: sortClass,
                headerClass: 'slds-is-sortable',
                ariaSort: isSorted ? (this._sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
            };
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Row processing
    // ─────────────────────────────────────────────────────────────────

    get processedRows() {
        if (!this.hasRecords || !this._metadataLoaded) {
            return [];
        }

        const columns = this.processedColumns;
        let rows = this.safeRecords;

        // Apply search filter
        if (this._searchTerm) {
            const term = this._searchTerm.toLowerCase();
            rows = rows.filter(record => {
                return columns.some(col => {
                    const val = this.getFieldValue(record, col.fieldApiName);
                    return val != null && String(val).toLowerCase().includes(term);
                });
            });
        }

        // Apply sort
        if (this._sortField) {
            const field = this._sortField;
            const dir = this._sortDirection === 'asc' ? 1 : -1;
            rows = [...rows].sort((a, b) => {
                const aVal = this.getFieldValue(a, field);
                const bVal = this.getFieldValue(b, field);
                if (aVal == null && bVal == null) return 0;
                if (aVal == null) return 1;
                if (bVal == null) return -1;
                if (typeof aVal === 'string') {
                    return dir * aVal.localeCompare(String(bVal));
                }
                if (aVal < bVal) return -1 * dir;
                if (aVal > bVal) return 1 * dir;
                return 0;
            });
        }

        return rows.map((record, index) => {
            const recordId = record.Id;
            const isSelected = this._selectedIds.has(recordId);
            const isEdited = this._editedRecordMap.has(recordId);

            let rowClass = 'slds-hint-parent';
            if (isSelected) {
                rowClass += ' row-selected';
            }
            if (this.isSelectable) {
                rowClass += ' row-selectable';
            }

            const cells = columns.map((col, colIndex) => {
                const rawValue = this.getFieldValue(record, col.fieldApiName);
                const editedValues = this._editedRecordMap.get(recordId);
                const hasEdit = editedValues && editedValues.hasOwnProperty(col.fieldApiName);
                const displayRawValue = hasEdit ? editedValues[col.fieldApiName] : rawValue;

                const isCurrentlyEditing = this._editingCell &&
                    this._editingCell.recordId === recordId &&
                    this._editingCell.fieldName === col.fieldApiName;

                const canEditThisCell = col.isEditable;

                // Format display value — for picklists, resolve API value to label
                let displayValue;
                if ((col.dataType === 'PICKLIST' || col.dataType === 'MULTIPICKLIST') && col.picklistValues && displayRawValue != null) {
                    if (col.dataType === 'MULTIPICKLIST' && typeof displayRawValue === 'string') {
                        displayValue = displayRawValue.split(';').map(v => {
                            const match = col.picklistValues.find(pv => pv.value === v.trim());
                            return match ? match.label : v.trim();
                        }).join('; ');
                    } else {
                        const match = col.picklistValues.find(pv => pv.value === displayRawValue);
                        displayValue = match ? match.label : String(displayRawValue);
                    }
                } else {
                    displayValue = this.formatValue(displayRawValue, col.dataType);
                }

                // Relationship link info
                let isLink = col.isRelationship && displayRawValue != null;
                let linkRecordId = null;
                if (isLink && col.relationshipIdField) {
                    linkRecordId = record[col.relationshipIdField];
                    if (!linkRecordId) {
                        isLink = false;
                    }
                }

                let cellClass = 'cell-value';
                if (hasEdit) {
                    cellClass += ' cell-edited';
                }
                if (canEditThisCell && !isCurrentlyEditing) {
                    cellClass += ' cell-editable';
                }

                // Determine input type for edit mode
                let inputType = 'text';
                let isPicklist = false;
                let isCheckbox = false;
                let picklistOptions = [];
                if (col.dataType === 'DOUBLE' || col.dataType === 'INTEGER' || col.dataType === 'CURRENCY' || col.dataType === 'PERCENT') {
                    inputType = 'number';
                } else if (col.dataType === 'DATE') {
                    inputType = 'date';
                } else if (col.dataType === 'DATETIME') {
                    inputType = 'datetime';
                } else if (col.dataType === 'BOOLEAN') {
                    isCheckbox = true;
                } else if (col.dataType === 'PICKLIST' || col.dataType === 'MULTIPICKLIST') {
                    isPicklist = true;
                    if (col.picklistValues) {
                        picklistOptions = col.picklistValues.map(pv => ({
                            label: pv.label,
                            value: pv.value
                        }));
                    }
                }

                // Show pencil icon on editable cells when not currently editing
                const showPencil = canEditThisCell && !isCurrentlyEditing;

                return {
                    key: `cell-${recordId}-${colIndex}`,
                    fieldName: col.fieldApiName,
                    value: displayRawValue,
                    displayValue: displayValue,
                    isEditing: isCurrentlyEditing,
                    canEdit: canEditThisCell,
                    showPencil: showPencil,
                    isLink: isLink,
                    linkRecordId: linkRecordId,
                    isCheckbox: isCheckbox,
                    isPicklist: isPicklist,
                    isStandardInput: !isCheckbox && !isPicklist,
                    inputType: inputType,
                    picklistOptions: picklistOptions,
                    cellClass: cellClass,
                    isBoolean: col.dataType === 'BOOLEAN',
                    booleanDisplay: col.dataType === 'BOOLEAN' ? (displayRawValue ? 'Yes' : 'No') : ''
                };
            });

            return {
                key: recordId || `row-${index}`,
                recordId: recordId,
                rowNumber: index + 1,
                isSelected: isSelected,
                rowClass: rowClass,
                cells: cells,
                ariaSelected: isSelected ? 'true' : 'false'
            };
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Field value resolution
    // ─────────────────────────────────────────────────────────────────

    getFieldValue(record, fieldPath) {
        if (!record || !fieldPath) return null;
        const parts = fieldPath.split('.');
        let value = record;
        for (const part of parts) {
            if (value == null) return null;
            value = value[part];
        }
        return value;
    }

    formatValue(value, dataType) {
        if (value == null) return '';
        if (dataType === 'BOOLEAN') {
            return value ? 'Yes' : 'No';
        }
        if (dataType === 'CURRENCY') {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
        }
        if (dataType === 'PERCENT') {
            return value + '%';
        }
        if (dataType === 'DATE') {
            try {
                const d = new Date(value);
                return d.toLocaleDateString();
            } catch (e) {
                return String(value);
            }
        }
        if (dataType === 'DATETIME') {
            try {
                const d = new Date(value);
                return d.toLocaleString();
            } catch (e) {
                return String(value);
            }
        }
        return String(value);
    }

    // ─────────────────────────────────────────────────────────────────
    // Selection handling
    // ─────────────────────────────────────────────────────────────────

    initializeSelections() {
        this._selectedIds = new Set();
    }

    handleRowClick(event) {
        if (this.isViewOnly) return;

        const recordId = event.currentTarget.dataset.recordId;
        if (!recordId) return;

        const newSelectedIds = new Set(this._selectedIds);

        if (this.isSingleSelect) {
            if (newSelectedIds.has(recordId)) {
                newSelectedIds.clear();
            } else {
                newSelectedIds.clear();
                newSelectedIds.add(recordId);
            }
        } else if (this.isMultiSelect) {
            if (newSelectedIds.has(recordId)) {
                newSelectedIds.delete(recordId);
            } else {
                newSelectedIds.add(recordId);
            }
        }

        this._selectedIds = newSelectedIds;
        this.updateSelectionOutputs();
    }

    handleSelectAll() {
        if (!this.isMultiSelect) return;

        const newSelectedIds = new Set(this._selectedIds);

        if (this.isAllSelected) {
            // Deselect all
            newSelectedIds.clear();
        } else {
            // Select all visible (filtered) rows
            this.processedRows.forEach(row => {
                if (row.recordId) {
                    newSelectedIds.add(row.recordId);
                }
            });
        }

        this._selectedIds = newSelectedIds;
        this.updateSelectionOutputs();
    }

    updateSelectionOutputs() {
        const allRecords = this.safeRecords;
        const selected = allRecords.filter(r => r && r.Id && this._selectedIds.has(r.Id));

        this.dispatchEvent(
            new FlowAttributeChangeEvent('selectedRecords', selected)
        );
        this.dispatchEvent(
            new FlowAttributeChangeEvent('selectedCount', selected.length)
        );

        // Refresh edited records output since it filters by selection
        if (this.canInlineEdit && this._editedRecordMap.size > 0) {
            this.updateEditOutputs();
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Inline edit handling
    // ─────────────────────────────────────────────────────────────────

    handleCellDblClick(event) {
        if (!this.canInlineEdit) return;

        const recordId = event.currentTarget.dataset.recordId;
        const fieldName = event.currentTarget.dataset.fieldName;
        const canEdit = event.currentTarget.dataset.canEdit;

        if (canEdit !== 'true') return;

        this._editingCell = { recordId, fieldName };
    }

    handlePencilClick(event) {
        event.stopPropagation();
        const recordId = event.currentTarget.dataset.recordId;
        const fieldName = event.currentTarget.dataset.fieldName;

        if (!recordId || !fieldName) return;

        this._editingCell = { recordId, fieldName };
    }

    handleCellInputChange(event) {
        const recordId = event.currentTarget.dataset.recordId;
        const fieldName = event.currentTarget.dataset.fieldName;
        let newValue = event.target.value;

        // For checkboxes, use checked property
        if (event.target.type === 'checkbox') {
            newValue = event.target.checked;
        }

        this.saveEdit(recordId, fieldName, newValue);
    }

    handleCellInputBlur(event) {
        // Don't close editing if we're tab-navigating to the next cell
        if (this._tabNavigating) return;
        this._editingCell = null;
    }

    handleCellInputKeydown(event) {
        if (event.key === 'Enter') {
            this._editingCell = null;
            return;
        }
        if (event.key === 'Escape') {
            this._editingCell = null;
            return;
        }
        if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();

            // Save current edit value before navigating
            const inputEl = event.currentTarget;
            const recordId = inputEl.dataset.recordId;
            const fieldName = inputEl.dataset.fieldName;
            const currentValue = inputEl.type === 'checkbox'
                ? inputEl.checked
                : inputEl.value;
            this.saveEdit(recordId, fieldName, currentValue);

            // Find current row and compute next row
            const rows = this.processedRows;
            const currentIndex = rows.findIndex(r => r.recordId === recordId);
            if (currentIndex === -1) {
                this._editingCell = null;
                return;
            }

            const nextIndex = event.shiftKey ? currentIndex - 1 : currentIndex + 1;

            // At boundary — stop editing
            if (nextIndex < 0 || nextIndex >= rows.length) {
                this._editingCell = null;
                return;
            }

            // Navigate to same field in next/previous row
            this._tabNavigating = true;
            const nextRow = rows[nextIndex];
            this._editingCell = { recordId: nextRow.recordId, fieldName: fieldName };

            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => {
                this._tabNavigating = false;
                this.focusEditingCell();
            }, 0);
        }
    }

    handlePicklistChange(event) {
        const recordId = event.currentTarget.dataset.recordId;
        const fieldName = event.currentTarget.dataset.fieldName;
        const newValue = event.detail.value;

        this.saveEdit(recordId, fieldName, newValue);
        this._editingCell = null;
    }

    saveEdit(recordId, fieldName, newValue) {
        // Compare against original record value — skip if unchanged
        const originalRecord = this.safeRecords.find(r => r && r.Id === recordId);
        const originalValue = originalRecord ? this.getFieldValue(originalRecord, fieldName) : undefined;

        const newMap = new Map(this._editedRecordMap);

        if (this._valuesEqual(newValue, originalValue)) {
            // Value matches original — remove this field from edits
            if (newMap.has(recordId)) {
                const edits = { ...newMap.get(recordId) };
                delete edits[fieldName];
                if (Object.keys(edits).length === 0) {
                    newMap.delete(recordId);
                } else {
                    newMap.set(recordId, edits);
                }
            }
        } else {
            // Actual change — store it
            if (!newMap.has(recordId)) {
                newMap.set(recordId, {});
            }
            const edits = { ...newMap.get(recordId) };
            edits[fieldName] = newValue;
            newMap.set(recordId, edits);
        }

        this._editedRecordMap = newMap;
        this.updateEditOutputs();
    }

    updateEditOutputs() {
        const allRecords = this.safeRecords;
        const edited = [];

        this._editedRecordMap.forEach((edits, recordId) => {
            // In selection modes, only include records that are both edited AND selected
            if (this.isSelectable && !this._selectedIds.has(recordId)) {
                return;
            }

            const original = allRecords.find(r => r && r.Id === recordId);
            if (original) {
                const merged = { ...original, ...edits };
                edited.push(merged);
            }
        });

        this.dispatchEvent(
            new FlowAttributeChangeEvent('editedRecords', edited)
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // Search handling
    // ─────────────────────────────────────────────────────────────────

    handleSearchChange(event) {
        this._searchTerm = event.target.value || '';
    }

    handleClearSearch() {
        this._searchTerm = '';
    }

    // ─────────────────────────────────────────────────────────────────
    // Sort handling
    // ─────────────────────────────────────────────────────────────────

    handleSort(event) {
        const fieldName = event.currentTarget.dataset.fieldName;
        if (!fieldName) return;

        if (this._sortField === fieldName) {
            // Toggle direction
            this._sortDirection = this._sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this._sortField = fieldName;
            this._sortDirection = 'asc';
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Navigation (relationship links)
    // ─────────────────────────────────────────────────────────────────

    handleRecordLink(event) {
        event.preventDefault();
        event.stopPropagation();

        const recordId = event.currentTarget.dataset.linkRecordId;
        if (!recordId) return;

        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: recordId,
                actionName: 'view'
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Utility
    // ─────────────────────────────────────────────────────────────────

    _valuesEqual(a, b) {
        // Both null/undefined/empty string — treat as equal
        if ((a == null || a === '') && (b == null || b === '')) return true;
        // One is null/empty, other isn't
        if (a == null || a === '' || b == null || b === '') return false;
        // Loose equality handles number/string coercion (e.g., "42" == 42)
        // eslint-disable-next-line eqeqeq
        return a == b;
    }

    focusEditingCell() {
        if (!this._editingCell) return;
        const { recordId, fieldName } = this._editingCell;
        const selector = `td[data-record-id="${recordId}"][data-field-name="${fieldName}"]`;
        const cell = this.template.querySelector(selector);
        if (cell) {
            const input = cell.querySelector('lightning-input') || cell.querySelector('lightning-combobox');
            if (input) {
                input.focus();
            }
        }
    }

    normalizeError(error) {
        if (typeof error === 'string') return error;
        if (error.body && error.body.message) return error.body.message;
        if (error.message) return error.message;
        return 'An unknown error occurred';
    }
}
