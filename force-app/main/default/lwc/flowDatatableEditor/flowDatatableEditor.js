import { LightningElement, api } from 'lwc';
import getObjectFields from '@salesforce/apex/FlowDatatableService.getObjectFields';
import getAvailableSObjects from '@salesforce/apex/FlowDatatableService.getAvailableSObjects';

export default class FlowDatatableEditor extends LightningElement {

    // ─────────────────────────────────────────────────────────────────
    // Flow Builder CPE API
    // ─────────────────────────────────────────────────────────────────
    _inputVariables = [];
    _genericTypeMappings = [];
    _builderContext = {};
    _initialized = false;

    @api
    get inputVariables() {
        return this._inputVariables;
    }
    set inputVariables(variables) {
        this._inputVariables = variables || [];
        if (this._initialized) {
            return;
        }
        this._initFromInputVariables();
        this._initialized = true;
    }

    @api
    get genericTypeMappings() {
        return this._genericTypeMappings;
    }
    set genericTypeMappings(mappings) {
        this._genericTypeMappings = mappings || [];
        this._resolveObjectApiName();
    }

    @api
    get builderContext() {
        return this._builderContext;
    }
    set builderContext(context) {
        this._builderContext = context || {};
    }

    // ─────────────────────────────────────────────────────────────────
    // Local state
    // ─────────────────────────────────────────────────────────────────

    // Derived from generic type mapping T or object picker
    objectApiName = '';

    // Object picker state
    _availableSObjects = [];
    _sObjectsLoaded = false;
    _objectSearchTerm = '';
    _showObjectPicker = false;

    // Records collection picker
    _selectedRecordsVariable = '';

    // Column configuration - array of { id, fieldApiName, label, customLabel, dataType, isRelationship, relationshipName, relatedObjectName, allowEdit }
    columns = [];
    _nextColumnId = 1;

    // Available fields from Apex
    availableFields = [];
    _fieldsLoaded = false;
    _fieldsError = null;
    _fieldSearchTerm = '';

    // Other settings
    selectionMode = 'View Only';
    enableInlineEdit = false;
    visibleRows = 10;
    showSearch = true;
    headerText = '';
    showRowNumbers = false;
    headerRowHeight = 32;
    rowHeight = 32;

    // ─────────────────────────────────────────────────────────────────
    // Initialization
    // ─────────────────────────────────────────────────────────────────

    connectedCallback() {
        this._loadSObjects();
    }

    async _loadSObjects() {
        try {
            this._availableSObjects = await getAvailableSObjects();
            this._sObjectsLoaded = true;
        } catch (error) {
            this._sObjectsLoaded = true;
        }
    }

    _initFromInputVariables() {
        this.selectionMode = this._getInputValue('selectionMode') || 'View Only';
        this.enableInlineEdit = this._getInputValue('enableInlineEdit') === true || this._getInputValue('enableInlineEdit') === 'true';
        this.showSearch = this._getInputValue('showSearch') === true || this._getInputValue('showSearch') === 'true';
        this.showRowNumbers = this._getInputValue('showRowNumbers') === true || this._getInputValue('showRowNumbers') === 'true';
        this.headerText = this._getInputValue('headerText') || '';

        const rowsVal = this._getInputValue('visibleRows');
        this.visibleRows = rowsVal != null && rowsVal !== '' ? parseInt(rowsVal, 10) : 10;

        const hHeightVal = this._getInputValue('headerRowHeight');
        this.headerRowHeight = hHeightVal != null && hHeightVal !== '' ? parseInt(hHeightVal, 10) : 32;

        const dHeightVal = this._getInputValue('rowHeight');
        this.rowHeight = dHeightVal != null && dHeightVal !== '' ? parseInt(dHeightVal, 10) : 32;

        // Parse columns from fieldNames + columnLabels + editableFields
        const fieldNamesStr = this._getInputValue('fieldNames') || '';
        const columnLabelsStr = this._getInputValue('columnLabels') || '';
        const editableFieldsStr = this._getInputValue('editableFields') || '';

        if (fieldNamesStr) {
            const fieldNames = fieldNamesStr.split(',').map(f => f.trim()).filter(f => f);
            const labels = columnLabelsStr ? columnLabelsStr.split(',').map(l => l.trim()) : [];
            const editableSet = new Set(
                editableFieldsStr ? editableFieldsStr.split(',').map(f => f.trim()).filter(f => f) : []
            );

            this.columns = fieldNames.map((fn, i) => ({
                id: this._nextColumnId++,
                fieldApiName: fn,
                label: fn,
                customLabel: labels[i] || '',
                dataType: '',
                isRelationship: fn.includes('.'),
                relationshipName: '',
                relatedObjectName: '',
                allowEdit: editableSet.has(fn)
            }));
        }

        // Read records variable reference
        const recordsVar = this._inputVariables.find(v => v.name === 'records');
        this._selectedRecordsVariable = recordsVar ? recordsVar.value : '';

        // Read objectApiName if it was previously set
        const objName = this._getInputValue('objectApiName');
        if (objName) {
            this.objectApiName = objName;
            this._loadFields();
        }
    }

    _resolveObjectApiName() {
        // Read the T generic type mapping to get the object API name
        const tMapping = this._genericTypeMappings.find(m => m.typeName === 'T');
        if (tMapping && tMapping.typeValue) {
            const newObjectName = tMapping.typeValue;
            if (newObjectName !== this.objectApiName) {
                this.objectApiName = newObjectName;
                // Sync objectApiName to the main component
                this._dispatchChange('objectApiName', newObjectName, 'String');
                this._loadFields();
            }
        }
    }

    async _loadFields() {
        if (!this.objectApiName) return;

        this._fieldsLoaded = false;
        this._fieldsError = null;

        try {
            const fields = await getObjectFields({ objectApiName: this.objectApiName });
            this.availableFields = fields;
            this._fieldsLoaded = true;

            // Enrich existing columns with metadata from loaded fields
            this._enrichColumns();
        } catch (error) {
            this._fieldsError = error.body ? error.body.message : error.message;
            this._fieldsLoaded = true;
        }
    }

    _enrichColumns() {
        if (!this.availableFields.length) return;

        const fieldMap = {};
        this.availableFields.forEach(f => {
            fieldMap[f.apiName.toLowerCase()] = f;
        });

        this.columns = this.columns.map(col => {
            const match = fieldMap[col.fieldApiName.toLowerCase()];
            if (match) {
                return {
                    ...col,
                    label: match.label,
                    dataType: match.dataType,
                    isRelationship: match.isRelationship,
                    relationshipName: match.relationshipName || '',
                    relatedObjectName: match.relatedObjectName || ''
                };
            }
            return col;
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // Computed properties
    // ─────────────────────────────────────────────────────────────────

    get hasObject() {
        return this.objectApiName && this.objectApiName.length > 0;
    }

    get hasColumns() {
        return this.columns.length > 0;
    }

    get fieldsLoading() {
        return this.hasObject && !this._fieldsLoaded;
    }

    get filteredAvailableFields() {
        if (!this.availableFields) return [];

        // Exclude fields already added as columns
        const addedFields = new Set(this.columns.map(c => c.fieldApiName.toLowerCase()));

        let fields = this.availableFields.filter(f => !addedFields.has(f.apiName.toLowerCase()));

        // Apply search filter
        if (this._fieldSearchTerm) {
            const term = this._fieldSearchTerm.toLowerCase();
            fields = fields.filter(f =>
                f.label.toLowerCase().includes(term) ||
                f.apiName.toLowerCase().includes(term)
            );
        }

        return fields.map(f => ({
            ...f,
            key: f.apiName,
            displayLabel: f.label,
            displayDetail: f.apiName + ' (' + f.dataType + ')',
            isLookup: f.isRelationship,
            iconName: f.isRelationship ? 'utility:record_lookup' : 'utility:text'
        }));
    }

    get hasFilteredFields() {
        return this.filteredAvailableFields.length > 0;
    }

    get selectionModeOptions() {
        return [
            { label: 'View Only', value: 'View Only' },
            { label: 'Single Select', value: 'Single Select' },
            { label: 'Multi Select', value: 'Multi Select' }
        ];
    }

    get objectLabel() {
        return this.objectApiName || 'No object selected';
    }

    get showObjectPicker() {
        return !this.objectApiName || this._showObjectPicker;
    }

    get objectPickerLoading() {
        return !this._sObjectsLoaded;
    }

    get filteredSObjects() {
        if (!this._availableSObjects) return [];

        let objects = this._availableSObjects;

        if (this._objectSearchTerm) {
            const term = this._objectSearchTerm.toLowerCase();
            objects = objects.filter(o =>
                o.label.toLowerCase().includes(term) ||
                o.apiName.toLowerCase().includes(term)
            );
        }

        return objects.slice(0, 50);
    }

    get hasFilteredSObjects() {
        return this.filteredSObjects.length > 0;
    }

    get availableRecordCollections() {
        const options = [];
        const addedNames = new Set();

        // Check explicit Flow variables for SObject collections
        if (this._builderContext && this._builderContext.variables) {
            this._builderContext.variables.forEach(v => {
                if (v.dataType === 'SObject' && v.isCollection && !addedNames.has(v.name)) {
                    const label = v.objectType
                        ? v.name + ' (' + v.objectType + ')'
                        : v.name;
                    options.push({ label, value: v.name });
                    addedNames.add(v.name);
                }
            });
        }

        // Check record lookups (Get Records elements) that return collections
        if (this._builderContext && this._builderContext.recordLookups) {
            this._builderContext.recordLookups.forEach(rl => {
                if (!rl.getFirstRecordOnly && !addedNames.has(rl.name)) {
                    const label = rl.object
                        ? rl.name + ' (' + rl.object + ')'
                        : rl.name;
                    options.push({ label, value: rl.name });
                    addedNames.add(rl.name);
                }
            });
        }

        return options;
    }

    get hasRecordCollections() {
        return this.availableRecordCollections.length > 0;
    }

    get columnCountLabel() {
        return `Columns (${this.columns.length})`;
    }

    // ─────────────────────────────────────────────────────────────────
    // Object picker handlers
    // ─────────────────────────────────────────────────────────────────

    handleObjectSearch(event) {
        this._objectSearchTerm = event.target.value || '';
    }

    handleSelectObject(event) {
        const apiName = event.currentTarget.dataset.apiName;
        this.objectApiName = apiName;
        this._showObjectPicker = false;
        this._objectSearchTerm = '';

        // Dispatch generic type mapping change so Flow Builder knows the T type
        this.dispatchEvent(new CustomEvent(
            'configuration_editor_generic_type_mapping_changed',
            {
                bubbles: true,
                cancelable: false,
                composed: true,
                detail: { typeName: 'T', typeValue: apiName }
            }
        ));

        // Also set objectApiName for the main component
        this._dispatchChange('objectApiName', apiName, 'String');

        // Load fields for this object
        this._loadFields();
    }

    handleChangeObject() {
        this._showObjectPicker = true;
    }

    handleRecordsChange(event) {
        const newValue = event.detail.value || event.target.value || '';
        this._selectedRecordsVariable = newValue;
        this.dispatchEvent(new CustomEvent(
            'configuration_editor_input_value_changed',
            {
                bubbles: true,
                cancelable: false,
                composed: true,
                detail: {
                    name: 'records',
                    newValue: newValue,
                    newValueDataType: 'reference'
                }
            }
        ));
    }

    // ─────────────────────────────────────────────────────────────────
    // Column management handlers
    // ─────────────────────────────────────────────────────────────────

    handleAddField(event) {
        const fieldApiName = event.currentTarget.dataset.fieldApiName;
        const field = this.availableFields.find(f => f.apiName === fieldApiName);
        if (!field) return;

        const newCol = {
            id: this._nextColumnId++,
            fieldApiName: field.apiName,
            label: field.label,
            customLabel: '',
            dataType: field.dataType,
            isRelationship: field.isRelationship,
            relationshipName: field.relationshipName || '',
            relatedObjectName: field.relatedObjectName || '',
            allowEdit: false
        };

        // If it's a relationship, auto-add as RelName.Name
        if (field.isRelationship && field.relationshipName) {
            newCol.fieldApiName = field.relationshipName + '.Name';
            newCol.label = field.label + ' Name';
            newCol.isRelationship = true;
        }

        this.columns = [...this.columns, newCol];
        this._dispatchColumnChanges();
    }

    handleRemoveColumn(event) {
        const colId = parseInt(event.currentTarget.dataset.colId, 10);
        this.columns = this.columns.filter(c => c.id !== colId);
        this._dispatchColumnChanges();
    }

    handleMoveUp(event) {
        const colId = parseInt(event.currentTarget.dataset.colId, 10);
        const index = this.columns.findIndex(c => c.id === colId);
        if (index <= 0) return;

        const newCols = [...this.columns];
        [newCols[index - 1], newCols[index]] = [newCols[index], newCols[index - 1]];
        this.columns = newCols;
        this._dispatchColumnChanges();
    }

    handleMoveDown(event) {
        const colId = parseInt(event.currentTarget.dataset.colId, 10);
        const index = this.columns.findIndex(c => c.id === colId);
        if (index < 0 || index >= this.columns.length - 1) return;

        const newCols = [...this.columns];
        [newCols[index], newCols[index + 1]] = [newCols[index + 1], newCols[index]];
        this.columns = newCols;
        this._dispatchColumnChanges();
    }

    handleCustomLabelChange(event) {
        const colId = parseInt(event.currentTarget.dataset.colId, 10);
        const newLabel = event.detail.value;
        this.columns = this.columns.map(c =>
            c.id === colId ? { ...c, customLabel: newLabel } : c
        );
        this._dispatchColumnChanges();
    }

    handleAllowEditChange(event) {
        const colId = parseInt(event.currentTarget.dataset.colId, 10);
        const checked = event.target.checked;
        this.columns = this.columns.map(c =>
            c.id === colId ? { ...c, allowEdit: checked } : c
        );
        this._dispatchColumnChanges();
    }

    handleFieldSearch(event) {
        this._fieldSearchTerm = event.target.value || '';
    }

    // ─────────────────────────────────────────────────────────────────
    // Settings handlers
    // ─────────────────────────────────────────────────────────────────

    handleSelectionModeChange(event) {
        this.selectionMode = event.detail.value;
        this._dispatchChange('selectionMode', this.selectionMode, 'String');
    }

    handleInlineEditChange(event) {
        this.enableInlineEdit = event.target.checked;
        this._dispatchChange('enableInlineEdit', this.enableInlineEdit, 'Boolean');
    }

    handleVisibleRowsChange(event) {
        const val = event.detail.value;
        this.visibleRows = val ? parseInt(val, 10) : 10;
        this._dispatchChange('visibleRows', this.visibleRows, 'Number');
    }

    handleShowSearchChange(event) {
        this.showSearch = event.target.checked;
        this._dispatchChange('showSearch', this.showSearch, 'Boolean');
    }

    handleShowRowNumbersChange(event) {
        this.showRowNumbers = event.target.checked;
        this._dispatchChange('showRowNumbers', this.showRowNumbers, 'Boolean');
    }

    handleHeaderTextChange(event) {
        this.headerText = event.detail.value;
        this._dispatchChange('headerText', this.headerText, 'String');
    }

    handleHeaderRowHeightChange(event) {
        const val = event.detail.value;
        this.headerRowHeight = val ? parseInt(val, 10) : 32;
        this._dispatchChange('headerRowHeight', String(this.headerRowHeight), 'String');
    }

    handleRowHeightChange(event) {
        const val = event.detail.value;
        this.rowHeight = val ? parseInt(val, 10) : 32;
        this._dispatchChange('rowHeight', String(this.rowHeight), 'String');
    }

    // ─────────────────────────────────────────────────────────────────
    // Dispatch helpers
    // ─────────────────────────────────────────────────────────────────

    _dispatchColumnChanges() {
        // Build comma-separated fieldNames
        const fieldNames = this.columns.map(c => c.fieldApiName).join(',');
        this._dispatchChange('fieldNames', fieldNames, 'String');

        // Build comma-separated columnLabels (custom labels)
        const columnLabels = this.columns.map(c => c.customLabel || '').join(',');
        this._dispatchChange('columnLabels', columnLabels, 'String');

        // Build comma-separated editableFields
        const editableFields = this.columns
            .filter(c => c.allowEdit)
            .map(c => c.fieldApiName)
            .join(',');
        this._dispatchChange('editableFields', editableFields, 'String');
    }

    _dispatchChange(name, newValue, newValueDataType) {
        this.dispatchEvent(new CustomEvent(
            'configuration_editor_input_value_changed',
            {
                bubbles: true,
                cancelable: false,
                composed: true,
                detail: { name, newValue, newValueDataType }
            }
        ));
    }

    _getInputValue(name) {
        const variable = this._inputVariables.find(v => v.name === name);
        return variable ? variable.value : null;
    }
}
