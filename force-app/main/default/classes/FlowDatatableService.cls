/**
 * @description Service class for the flowDatatable LWC component.
 *              Provides field metadata (labels, types, editability, picklist values)
 *              for dynamically configured table columns.
 *              Does NOT query records — records come from Flow.
 * @author WSM Development Team
 */
public with sharing class FlowDatatableService {

    // Cached Schema Describe
    private static Map<String, Schema.SObjectType> globalDescribe;

    /**
     * @description Lazily initializes and caches the global describe map.
     * @return Map of all SObject types in the org
     */
    private static Map<String, Schema.SObjectType> getGlobalDescribe() {
        if (globalDescribe == null) {
            globalDescribe = Schema.getGlobalDescribe();
        }
        return globalDescribe;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INNER CLASSES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @description Metadata about a single table column/field.
     */
    public class ColumnMetadata {
        @AuraEnabled public String fieldApiName;
        @AuraEnabled public String label;
        @AuraEnabled public String dataType;
        @AuraEnabled public Boolean isEditable;
        @AuraEnabled public Boolean isRelationship;
        @AuraEnabled public String relationshipIdField;
        @AuraEnabled public List<PicklistOption> picklistValues;
    }

    /**
     * @description A single picklist option with label and value.
     */
    public class PicklistOption {
        @AuraEnabled public String label;
        @AuraEnabled public String value;
    }

    /**
     * @description Basic info about an SObject type. Used by the CPE object picker.
     *              Implements Comparable to sort alphabetically by label.
     */
    public class SObjectInfo implements Comparable {
        @AuraEnabled public String apiName;
        @AuraEnabled public String label;

        public Integer compareTo(Object other) {
            if (other == null) return 1;
            SObjectInfo otherInfo = (SObjectInfo)other;
            if (this.label == null) return -1;
            if (otherInfo.label == null) return 1;
            return this.label.compareTo(otherInfo.label);
        }
    }

    /**
     * @description Info about a single field on an object. Used by the CPE field picker.
     *              Implements Comparable to sort alphabetically by label.
     */
    public class FieldInfo implements Comparable {
        @AuraEnabled public String apiName;
        @AuraEnabled public String label;
        @AuraEnabled public String dataType;
        @AuraEnabled public Boolean isRelationship;
        @AuraEnabled public String relationshipName;
        @AuraEnabled public String relatedObjectName;

        public Integer compareTo(Object other) {
            if (other == null) return 1;
            FieldInfo otherField = (FieldInfo)other;
            if (this.label == null) return -1;
            if (otherField.label == null) return 1;
            return this.label.compareTo(otherField.label);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC METHODS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @description Returns field metadata for the specified object and fields.
     * @param objectApiName API name of the SObject (e.g. "Account", "Custom__c")
     * @param fieldNames Comma-separated field API names (e.g. "Name,Industry,Account__r.Name")
     * @return List of ColumnMetadata for each resolved field
     */
    @AuraEnabled(cacheable=true)
    public static List<ColumnMetadata> getColumnMetadata(String objectApiName, String fieldNames) {
        List<ColumnMetadata> columns = new List<ColumnMetadata>();

        if (String.isBlank(objectApiName) || String.isBlank(fieldNames)) {
            return columns;
        }

        Map<String, Schema.SObjectType> describe = getGlobalDescribe();
        Schema.SObjectType sObjectType = describe.get(objectApiName.trim().toLowerCase());

        if (sObjectType == null) {
            throw new AuraHandledException('Object not found: ' + objectApiName);
        }

        Schema.DescribeSObjectResult objectDescribe = sObjectType.getDescribe();

        List<String> fieldList = fieldNames.split(',');
        for (String rawField : fieldList) {
            String fieldName = rawField.trim();
            if (String.isBlank(fieldName)) {
                continue;
            }

            try {
                ColumnMetadata col = resolveField(objectDescribe, fieldName, describe);
                if (col != null) {
                    columns.add(col);
                }
            } catch (Exception e) {
                // Skip fields that can't be resolved (non-existent, no access, etc.)
                ColumnMetadata errorCol = new ColumnMetadata();
                errorCol.fieldApiName = fieldName;
                errorCol.label = fieldName;
                errorCol.dataType = 'STRING';
                errorCol.isEditable = false;
                errorCol.isRelationship = false;
                columns.add(errorCol);
            }
        }

        return columns;
    }

    /**
     * @description Returns all accessible fields for an object. Used by the CPE field picker.
     * @param objectApiName API name of the SObject
     * @return List of FieldInfo sorted alphabetically by label
     */
    @AuraEnabled(cacheable=true)
    public static List<FieldInfo> getObjectFields(String objectApiName) {
        List<FieldInfo> fields = new List<FieldInfo>();

        if (String.isBlank(objectApiName)) {
            return fields;
        }

        Map<String, Schema.SObjectType> describe = getGlobalDescribe();
        Schema.SObjectType sObjectType = describe.get(objectApiName.trim().toLowerCase());

        if (sObjectType == null) {
            throw new AuraHandledException('Object not found: ' + objectApiName);
        }

        Schema.DescribeSObjectResult objectDescribe = sObjectType.getDescribe();
        Map<String, Schema.SObjectField> fieldMap = objectDescribe.fields.getMap();

        for (String fieldName : fieldMap.keySet()) {
            Schema.DescribeFieldResult fd = fieldMap.get(fieldName).getDescribe();

            if (!fd.isAccessible()) {
                continue;
            }

            FieldInfo fi = new FieldInfo();
            fi.apiName = fd.getName();
            fi.label = fd.getLabel();
            fi.dataType = fd.getType().name();
            fi.isRelationship = (fd.getType() == Schema.DisplayType.REFERENCE);

            // For relationship fields, include the relationship name and related object
            if (fi.isRelationship) {
                fi.relationshipName = fd.getRelationshipName();
                List<Schema.SObjectType> refs = fd.getReferenceTo();
                if (!refs.isEmpty()) {
                    fi.relatedObjectName = refs[0].getDescribe().getName();
                }
            }

            fields.add(fi);
        }

        fields.sort();
        return fields;
    }

    /**
     * @description Returns a list of queryable, accessible SObject types for the CPE object picker.
     *              Filters out internal/system objects (feeds, histories, shares, change events, etc.).
     * @return List of SObjectInfo sorted alphabetically by label
     */
    @AuraEnabled(cacheable=true)
    public static List<SObjectInfo> getAvailableSObjects() {
        List<SObjectInfo> objects = new List<SObjectInfo>();
        Map<String, Schema.SObjectType> describe = getGlobalDescribe();

        for (String key : describe.keySet()) {
            Schema.DescribeSObjectResult objDesc = describe.get(key).getDescribe();

            if (!objDesc.isQueryable() || !objDesc.isAccessible()) {
                continue;
            }

            String name = objDesc.getName();

            // Skip internal/system object patterns
            if (name.startsWith('__') ||
                name.endsWith('__Feed') ||
                name.endsWith('__History') ||
                name.endsWith('__Share') ||
                name.endsWith('__ChangeEvent') ||
                name.endsWith('__Tag') ||
                name.endsWith('__e')) {
                continue;
            }

            SObjectInfo info = new SObjectInfo();
            info.apiName = name;
            info.label = objDesc.getLabel();
            objects.add(info);
        }

        objects.sort();
        return objects;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIVATE METHODS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @description Resolves a single field path into ColumnMetadata.
     *              Handles both direct fields (e.g. "Name") and relationship
     *              traversals (e.g. "Account__r.Name", "CreatedBy.Name").
     */
    private static ColumnMetadata resolveField(
        Schema.DescribeSObjectResult objectDescribe,
        String fieldPath,
        Map<String, Schema.SObjectType> describe
    ) {
        ColumnMetadata col = new ColumnMetadata();
        col.fieldApiName = fieldPath;
        col.isRelationship = false;

        // Check if this is a relationship traversal (contains ".")
        if (fieldPath.contains('.')) {
            return resolveRelationshipField(objectDescribe, fieldPath, describe);
        }

        // Direct field
        Map<String, Schema.SObjectField> fieldMap = objectDescribe.fields.getMap();
        Schema.SObjectField field = fieldMap.get(fieldPath.toLowerCase());

        if (field == null) {
            throw new AuraHandledException('Field not found: ' + fieldPath);
        }

        Schema.DescribeFieldResult fieldDescribe = field.getDescribe();

        if (!fieldDescribe.isAccessible()) {
            throw new AuraHandledException('Field not accessible: ' + fieldPath);
        }

        col.label = fieldDescribe.getLabel();
        col.dataType = fieldDescribe.getType().name();
        col.isEditable = fieldDescribe.isUpdateable();

        // If this is a reference/lookup field, mark it as a relationship
        if (fieldDescribe.getType() == Schema.DisplayType.REFERENCE) {
            col.isRelationship = true;
            col.relationshipIdField = fieldPath;
        }

        // Populate picklist values if applicable
        if (fieldDescribe.getType() == Schema.DisplayType.PICKLIST ||
            fieldDescribe.getType() == Schema.DisplayType.MULTIPICKLIST) {
            col.picklistValues = new List<PicklistOption>();
            for (Schema.PicklistEntry entry : fieldDescribe.getPicklistValues()) {
                if (entry.isActive()) {
                    PicklistOption opt = new PicklistOption();
                    opt.label = entry.getLabel();
                    opt.value = entry.getValue();
                    col.picklistValues.add(opt);
                }
            }
        }

        return col;
    }

    /**
     * @description Resolves a relationship field path like "Account__r.Name" or "CreatedBy.Name".
     *              Traverses the relationship to get the target field's metadata.
     */
    private static ColumnMetadata resolveRelationshipField(
        Schema.DescribeSObjectResult objectDescribe,
        String fieldPath,
        Map<String, Schema.SObjectType> describe
    ) {
        ColumnMetadata col = new ColumnMetadata();
        col.fieldApiName = fieldPath;
        col.isRelationship = true;
        col.isEditable = false; // Relationship traversals are read-only

        List<String> parts = fieldPath.split('\\.');
        if (parts.size() < 2) {
            throw new AuraHandledException('Invalid relationship path: ' + fieldPath);
        }

        // The first part is the relationship name (e.g. "Account__r" or "CreatedBy")
        String relationshipName = parts[0];
        // The second part is the field on the related object (e.g. "Name")
        String targetFieldName = parts[1];

        // Find the lookup/master-detail field that corresponds to this relationship
        Map<String, Schema.SObjectField> fieldMap = objectDescribe.fields.getMap();
        Schema.DescribeFieldResult lookupField = null;
        String lookupFieldApiName = null;

        for (String fName : fieldMap.keySet()) {
            Schema.DescribeFieldResult fd = fieldMap.get(fName).getDescribe();
            if (fd.getType() == Schema.DisplayType.REFERENCE) {
                String relName = fd.getRelationshipName();
                if (relName != null && relName.equalsIgnoreCase(relationshipName)) {
                    lookupField = fd;
                    lookupFieldApiName = fd.getName();
                    break;
                }
            }
        }

        if (lookupField == null) {
            throw new AuraHandledException('Relationship not found: ' + relationshipName);
        }

        col.relationshipIdField = lookupFieldApiName;

        // Get the related object's field describe
        List<Schema.SObjectType> referenceTo = lookupField.getReferenceTo();
        if (referenceTo.isEmpty()) {
            throw new AuraHandledException('Cannot resolve related object for: ' + relationshipName);
        }

        Schema.DescribeSObjectResult relatedObjectDescribe = referenceTo[0].getDescribe();
        Map<String, Schema.SObjectField> relatedFieldMap = relatedObjectDescribe.fields.getMap();
        Schema.SObjectField targetField = relatedFieldMap.get(targetFieldName.toLowerCase());

        if (targetField == null) {
            throw new AuraHandledException('Field not found on related object: ' + targetFieldName);
        }

        Schema.DescribeFieldResult targetFieldDescribe = targetField.getDescribe();

        if (!targetFieldDescribe.isAccessible()) {
            throw new AuraHandledException('Related field not accessible: ' + fieldPath);
        }

        // Use the relationship name + target field as the label
        col.label = lookupField.getLabel() + ' ' + targetFieldDescribe.getLabel();
        col.dataType = targetFieldDescribe.getType().name();

        return col;
    }
}
