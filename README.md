# Flow Datatable

[![Deploy to Salesforce](https://raw.githubusercontent.com/afawcett/githubsfdeploy/master/src/main/webapp/resources/img/deploy.png)](https://githubsfdeploy.herokuapp.com/app/githubdeploy/jcd386/Flow-Datatable?ref=main)

A configurable datatable Lightning Web Component for Salesforce Screen Flows. Supports any object type with a full-featured Custom Property Editor for visual configuration in Flow Builder.

## Features

- **Any SObject support** — works with any standard or custom object via generic `T` type
- **Selection modes** — View Only, Single Select, or Multi Select with checkbox/radio UI
- **Inline editing** — double-click or pencil icon to edit cells; supports text, number, date, boolean, and picklist fields
- **Picklist label display** — shows picklist labels (not API values) in display mode
- **Relationship field links** — lookup/master-detail fields render as clickable links that navigate to the related record
- **Column sorting** — click any column header to sort ascending/descending
- **Search filtering** — optional search bar to filter visible rows
- **Custom column labels** — override default field labels per column
- **Configurable font sizes** — set header and row font sizes independently
- **Row numbers** — optional row number column
- **Custom Property Editor** — visual drag-and-drop column builder with object picker, field search, and reordering

## Installation

### Option A: One-Click Deploy

Click the "Deploy to Salesforce" button above.

### Option B: SFDX CLI

```bash
# Clone the repo
git clone https://github.com/jcd386/Flow-Datatable.git
cd Flow-Datatable

# Deploy to your org
sf project deploy start --target-org YOUR_ORG_ALIAS
```

## Usage

1. Add the **Flow Datatable** component to a Screen Flow
2. Select the object type when prompted
3. Use the Custom Property Editor to:
   - Choose which fields to display as columns
   - Reorder columns with up/down arrows
   - Set custom labels for any column
   - Configure selection mode, inline editing, search, and display options
4. Pass a record collection (from a Get Records element) to the `Records` input
5. Use `Selected Records`, `Edited Records`, and `Selected Count` outputs in your flow

## Files

| File | Description |
|------|-------------|
| `flowDatatable/` | Main datatable LWC — renders the table with all features |
| `flowDatatableEditor/` | Custom Property Editor LWC — visual configuration UI in Flow Builder |
| `FlowDatatableService.cls` | Apex service — fetches field metadata, picklist values, and relationship info |
| `FlowDatatableServiceTest.cls` | Test class for FlowDatatableService |

## License

MIT
