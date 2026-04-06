$outPath = "C:\Users\AliJaffar\Downloads\Codex Project\ScanSnap_Power_Automate_Setup_Guide.docx"
$tempRoot = Join-Path $env:TEMP ("scansnap_docx_" + [guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Path $tempRoot | Out-Null
New-Item -ItemType Directory -Path (Join-Path $tempRoot "_rels") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $tempRoot "word") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $tempRoot "word\_rels") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $tempRoot "docProps") | Out-Null

$contentTypes = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
'@

$rels = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
'@

$documentRels = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
'@

$styles = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
</w:styles>
'@

$core = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>ScanSnap Power Automate Setup Guide</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-03-23T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-03-23T00:00:00Z</dcterms:modified>
</cp:coreProperties>
'@

$app = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Office Word</Application>
</Properties>
'@

$document = @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>ScanSnap Power Automate Setup Guide</w:t></w:r></w:p>
    <w:p><w:r><w:t>This document walks through the full cloud-flow setup for ScanSnap files that land in OneDrive. The solution uses two Power Automate cloud flows and one SharePoint list.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p>
    <w:p><w:r><w:t>Flow 1 logs each new ScanSnap file and stores a clickable OneDrive link in a SharePoint list.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Flow 2 runs nightly at 9:05 PM, builds a digest email with clickable file links, sends the email, and marks those items as processed.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Before You Start</w:t></w:r></w:p>
    <w:p><w:r><w:t>Make sure the ScanSnap files are landing in OneDrive for Business, not only on the local PC.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Make sure you have access to Power Automate, OneDrive for Business, SharePoint, and Office 365 Outlook.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Choose or create the OneDrive folder that will receive the scanned documents.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part 1: Create the SharePoint List</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Create the List</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Open SharePoint and create a new list named ScanSnapLog.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Keep the default Title column.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Add a Single line of text column named FileName.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Add a Single line of text column named FilePath.</w:t></w:r></w:p>
    <w:p><w:r><w:t>5. Add a Single line of text column named FolderName.</w:t></w:r></w:p>
    <w:p><w:r><w:t>6. Add a Date and time column named CreatedTime.</w:t></w:r></w:p>
    <w:p><w:r><w:t>7. Add a Single line of text column named FileLink.</w:t></w:r></w:p>
    <w:p><w:r><w:t>8. Add a Yes/No column named Processed and set the default value to No.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part 2: Build Flow 1 - Log New Files</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Create the Flow</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Open Power Automate.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Select Create.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Choose Automated cloud flow.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Name the flow ScanSnap - Log New Files.</w:t></w:r></w:p>
    <w:p><w:r><w:t>5. Choose the OneDrive for Business trigger named When a file is created (properties only).</w:t></w:r></w:p>
    <w:p><w:r><w:t>6. Click Create.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Configure the Trigger</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Select the ScanSnap folder in OneDrive where new files arrive.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Save the flow once so the connector is fully initialized.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Add the Filter Condition</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Add a new action named Condition.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Switch the left side to the Expression tab.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Paste this expression:</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">@and(</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">  not(contains(toLower(triggerBody()?['Path']), '.scansnap_config')),</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">  or(</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">    endsWith(toLower(triggerBody()?['Name']), '.pdf'),</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">    endsWith(toLower(triggerBody()?['Name']), '.jpg'),</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">    endsWith(toLower(triggerBody()?['Name']), '.jpeg'),</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">    endsWith(toLower(triggerBody()?['Name']), '.png')</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">  )</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">)</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Compare it to true.</w:t></w:r></w:p>
    <w:p><w:r><w:t>5. Leave the No branch empty.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Create the Share Link</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. In the Yes branch, add the action Create share link for a file or folder.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Set Id or File to the Id from the trigger.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Set Link type to View.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Set Scope to Organization.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Create the SharePoint Item</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Add the action Create item.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Select your SharePoint site.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Select the ScanSnapLog list.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Map Title to Name.</w:t></w:r></w:p>
    <w:p><w:r><w:t>5. Map FileName to Name.</w:t></w:r></w:p>
    <w:p><w:r><w:t>6. Map FilePath to Path.</w:t></w:r></w:p>
    <w:p><w:r><w:t>7. Map CreatedTime to Created.</w:t></w:r></w:p>
    <w:p><w:r><w:t>8. Map FileLink to the web URL returned by Create share link for a file or folder.</w:t></w:r></w:p>
    <w:p><w:r><w:t>9. Set Processed to No.</w:t></w:r></w:p>
    <w:p><w:r><w:t>10. For FolderName, open the Expression tab and paste this expression:</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">@last(split(replace(triggerBody()?['Path'], concat('/', triggerBody()?['Name']), ''), '/'))</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Test Flow 1</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Save the flow.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Upload one test PDF or image file into the ScanSnap OneDrive folder.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Confirm a new row appears in the ScanSnapLog SharePoint list.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Confirm the FileLink field contains a clickable URL.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part 3: Build Flow 2 - Nightly Digest</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Create the Flow</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. In Power Automate, select Create.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Choose Scheduled cloud flow.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Name the flow ScanSnap - Nightly Digest.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Set the schedule to run every 1 day.</w:t></w:r></w:p>
    <w:p><w:r><w:t>5. Set the start time to 9:05 PM.</w:t></w:r></w:p>
    <w:p><w:r><w:t>6. Set the time zone to Eastern Time.</w:t></w:r></w:p>
    <w:p><w:r><w:t>7. Click Create.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Get Unprocessed Items</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Add the action Get items for the ScanSnapLog SharePoint list.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. In Filter Query, enter:</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">Processed eq 0</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Only Continue If There Are Items</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Add a Condition action.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Switch to the Expression tab.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Paste this expression:</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">@greater(length(body('Get_items')?['value']), 0)</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Compare it to true.</w:t></w:r></w:p>
    <w:p><w:r><w:t>5. Leave the No branch empty or add a simple terminate action.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Initialize the Email Body</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. In the Yes branch, add Initialize variable.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Set Name to EmailBody.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Set Type to String.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Set Value to:</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;h2&gt;ScanSnap Daily Update&lt;/h2&gt;&lt;p&gt;New documents received today:&lt;/p&gt;&lt;ul&gt;</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Append One Line Per File</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Add an Apply to each action.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Use body('Get_items')?['value'] as the input.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Inside the loop, add Append to string variable.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Select the EmailBody variable.</w:t></w:r></w:p>
    <w:p><w:r><w:t>5. Paste this HTML as the value:</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;li&gt;&lt;a href="@{items('Apply_to_each')?['FileLink']}"&gt;@{items('Apply_to_each')?['FileName']}&lt;/a&gt;&lt;br/&gt;Folder: @{items('Apply_to_each')?['FolderName']}&lt;br/&gt;Added: @{items('Apply_to_each')?['CreatedTime']}&lt;/li&gt;</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Close the HTML List</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. After the first Apply to each loop, add Append to string variable.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Select EmailBody.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Use this value:</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;/ul&gt;</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Send the Email</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Add the Office 365 Outlook action Send an email (V2).</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Set To to your email address.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Set Subject to:</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">ScanSnap Daily Update - @{formatDateTime(utcNow(),'yyyy-MM-dd')} (@{length(body('Get_items')?['value'])} new document(s))</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Set Body to the EmailBody variable.</w:t></w:r></w:p>
    <w:p><w:r><w:t>5. Make sure the email body is treated as HTML if the designer exposes that setting.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Mark Items as Processed</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Add a second Apply to each action.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Use body('Get_items')?['value'] as the input again.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Inside the loop, add Update item.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Select the same SharePoint site and ScanSnapLog list.</w:t></w:r></w:p>
    <w:p><w:r><w:t>5. Set ID to the current item ID.</w:t></w:r></w:p>
    <w:p><w:r><w:t>6. Set Processed to Yes.</w:t></w:r></w:p>
    <w:p><w:r><w:t>7. Keep any required fields mapped from the current item if SharePoint requires them.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Test Flow 2</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Save the flow.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Run the flow manually the first time.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Check that the email arrives.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Click a file name in the email and confirm it opens the correct OneDrive file.</w:t></w:r></w:p>
    <w:p><w:r><w:t>5. Confirm the processed items are now marked Yes in SharePoint.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Troubleshooting</w:t></w:r></w:p>
    <w:p><w:r><w:t>If no rows appear in SharePoint, make sure the trigger is pointed at the correct OneDrive folder.</w:t></w:r></w:p>
    <w:p><w:r><w:t>If the email sends but the links do not work, check the sharing scope used in Create share link for a file or folder.</w:t></w:r></w:p>
    <w:p><w:r><w:t>If the digest repeats the same files every day, verify that the Update item action is setting Processed to Yes.</w:t></w:r></w:p>
    <w:p><w:r><w:t>If the flow triggers on unwanted file types, tighten the file extension checks in the Condition expression.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Outcome</w:t></w:r></w:p>
    <w:p><w:r><w:t>After setup, you will have a cloud-only process that logs new ScanSnap files from OneDrive, stores clickable file links, and sends a nightly summary email without using local Python scripts, PowerShell scripts, or hardcoded SMTP credentials.</w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:cols w:space="708"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>
'@

[System.IO.File]::WriteAllText((Join-Path $tempRoot "[Content_Types].xml"), $contentTypes)
[System.IO.File]::WriteAllText((Join-Path $tempRoot "_rels\.rels"), $rels)
[System.IO.File]::WriteAllText((Join-Path $tempRoot "word\document.xml"), $document)
[System.IO.File]::WriteAllText((Join-Path $tempRoot "word\_rels\document.xml.rels"), $documentRels)
[System.IO.File]::WriteAllText((Join-Path $tempRoot "word\styles.xml"), $styles)
[System.IO.File]::WriteAllText((Join-Path $tempRoot "docProps\core.xml"), $core)
[System.IO.File]::WriteAllText((Join-Path $tempRoot "docProps\app.xml"), $app)

if (Test-Path $outPath) {
    Remove-Item $outPath -Force
}

Compress-Archive -Path (Join-Path $tempRoot "*") -DestinationPath ($outPath + ".zip") -Force
Rename-Item -Path ($outPath + ".zip") -NewName ([System.IO.Path]::GetFileName($outPath))
Remove-Item $tempRoot -Recurse -Force

Write-Output $outPath
