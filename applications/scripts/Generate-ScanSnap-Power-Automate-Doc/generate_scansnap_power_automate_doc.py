from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape


OUT_PATH = Path(r"C:\Users\AliJaffar\Downloads\Codex Project\ScanSnap_Power_Automate_Setup_Guide.docx")


paragraphs = [
    ("title", "ScanSnap Power Automate Setup Guide"),
    ("normal", "This document walks through the full cloud-flow setup for ScanSnap files that land in OneDrive. The solution uses two Power Automate cloud flows and one SharePoint list."),
    ("heading1", "Overview"),
    ("normal", "Flow 1 logs each new ScanSnap file and stores a clickable OneDrive link in a SharePoint list."),
    ("normal", "Flow 2 runs nightly at 9:05 PM, builds a digest email with clickable file links, sends the email, and marks those items as processed."),
    ("heading1", "Before You Start"),
    ("normal", "Make sure the ScanSnap files are landing in OneDrive for Business, not only on the local PC."),
    ("normal", "Make sure you have access to Power Automate, OneDrive for Business, SharePoint, and Office 365 Outlook."),
    ("normal", "Choose or create the OneDrive folder that will receive the scanned documents."),
    ("heading1", "Part 1: Create the SharePoint List"),
    ("heading2", "Create the List"),
    ("normal", "1. Open SharePoint and create a new list named ScanSnapLog."),
    ("normal", "2. Keep the default Title column."),
    ("normal", "3. Add a Single line of text column named FileName."),
    ("normal", "4. Add a Single line of text column named FilePath."),
    ("normal", "5. Add a Single line of text column named FolderName."),
    ("normal", "6. Add a Date and time column named CreatedTime."),
    ("normal", "7. Add a Single line of text column named FileLink."),
    ("normal", "8. Add a Yes/No column named Processed and set the default value to No."),
    ("heading1", "Part 2: Build Flow 1 - Log New Files"),
    ("heading2", "Create the Flow"),
    ("normal", "1. Open Power Automate."),
    ("normal", "2. Select Create."),
    ("normal", "3. Choose Automated cloud flow."),
    ("normal", "4. Name the flow ScanSnap - Log New Files."),
    ("normal", "5. Choose the OneDrive for Business trigger named When a file is created (properties only)."),
    ("normal", "6. Click Create."),
    ("heading2", "Configure the Trigger"),
    ("normal", "1. Select the ScanSnap folder in OneDrive where new files arrive."),
    ("normal", "2. Save the flow once so the connector is fully initialized."),
    ("heading2", "Add the Filter Condition"),
    ("normal", "1. Add a new action named Condition."),
    ("normal", "2. Switch the left side to the Expression tab."),
    ("normal", "3. Paste this expression:"),
    ("code", "@and(\n  not(contains(toLower(triggerBody()?['Path']), '.scansnap_config')),\n  or(\n    endsWith(toLower(triggerBody()?['Name']), '.pdf'),\n    endsWith(toLower(triggerBody()?['Name']), '.jpg'),\n    endsWith(toLower(triggerBody()?['Name']), '.jpeg'),\n    endsWith(toLower(triggerBody()?['Name']), '.png')\n  )\n)"),
    ("normal", "4. Compare it to true."),
    ("normal", "5. Leave the No branch empty."),
    ("heading2", "Create the Share Link"),
    ("normal", "1. In the Yes branch, add the action Create share link for a file or folder."),
    ("normal", "2. Set Id or File to the Id from the trigger."),
    ("normal", "3. Set Link type to View."),
    ("normal", "4. Set Scope to Organization."),
    ("heading2", "Create the SharePoint Item"),
    ("normal", "1. Add the action Create item."),
    ("normal", "2. Select your SharePoint site."),
    ("normal", "3. Select the ScanSnapLog list."),
    ("normal", "4. Map Title to Name."),
    ("normal", "5. Map FileName to Name."),
    ("normal", "6. Map FilePath to Path."),
    ("normal", "7. Map CreatedTime to Created."),
    ("normal", "8. Map FileLink to the web URL returned by Create share link for a file or folder."),
    ("normal", "9. Set Processed to No."),
    ("normal", "10. For FolderName, open the Expression tab and paste this expression:"),
    ("code", "@last(split(replace(triggerBody()?['Path'], concat('/', triggerBody()?['Name']), ''), '/'))"),
    ("heading2", "Test Flow 1"),
    ("normal", "1. Save the flow."),
    ("normal", "2. Upload one test PDF or image file into the ScanSnap OneDrive folder."),
    ("normal", "3. Confirm a new row appears in the ScanSnapLog SharePoint list."),
    ("normal", "4. Confirm the FileLink field contains a clickable URL."),
    ("heading1", "Part 3: Build Flow 2 - Nightly Digest"),
    ("heading2", "Create the Flow"),
    ("normal", "1. In Power Automate, select Create."),
    ("normal", "2. Choose Scheduled cloud flow."),
    ("normal", "3. Name the flow ScanSnap - Nightly Digest."),
    ("normal", "4. Set the schedule to run every 1 day."),
    ("normal", "5. Set the start time to 9:05 PM."),
    ("normal", "6. Set the time zone to Eastern Time."),
    ("normal", "7. Click Create."),
    ("heading2", "Get Unprocessed Items"),
    ("normal", "1. Add the action Get items for the ScanSnapLog SharePoint list."),
    ("normal", "2. In Filter Query, enter:"),
    ("code", "Processed eq 0"),
    ("heading2", "Only Continue If There Are Items"),
    ("normal", "1. Add a Condition action."),
    ("normal", "2. Switch to the Expression tab."),
    ("normal", "3. Paste this expression:"),
    ("code", "@greater(length(body('Get_items')?['value']), 0)"),
    ("normal", "4. Compare it to true."),
    ("normal", "5. Leave the No branch empty or add a simple terminate action."),
    ("heading2", "Initialize the Email Body"),
    ("normal", "1. In the Yes branch, add Initialize variable."),
    ("normal", "2. Set Name to EmailBody."),
    ("normal", "3. Set Type to String."),
    ("normal", "4. Set Value to:"),
    ("code", "<h2>ScanSnap Daily Update</h2><p>New documents received today:</p><ul>"),
    ("heading2", "Append One Line Per File"),
    ("normal", "1. Add an Apply to each action."),
    ("normal", "2. Use body('Get_items')?['value'] as the input."),
    ("normal", "3. Inside the loop, add Append to string variable."),
    ("normal", "4. Select the EmailBody variable."),
    ("normal", "5. Paste this HTML as the value:"),
    ("code", "<li><a href=\"@{items('Apply_to_each')?['FileLink']}\">@{items('Apply_to_each')?['FileName']}</a><br/>Folder: @{items('Apply_to_each')?['FolderName']}<br/>Added: @{items('Apply_to_each')?['CreatedTime']}</li>"),
    ("heading2", "Close the HTML List"),
    ("normal", "1. After the first Apply to each loop, add Append to string variable."),
    ("normal", "2. Select EmailBody."),
    ("normal", "3. Use this value:"),
    ("code", "</ul>"),
    ("heading2", "Send the Email"),
    ("normal", "1. Add the Office 365 Outlook action Send an email (V2)."),
    ("normal", "2. Set To to your email address."),
    ("normal", "3. Set Subject to:"),
    ("code", "ScanSnap Daily Update - @{formatDateTime(utcNow(),'yyyy-MM-dd')} (@{length(body('Get_items')?['value'])} new document(s))"),
    ("normal", "4. Set Body to the EmailBody variable."),
    ("normal", "5. Make sure the email body is treated as HTML if the designer exposes that setting."),
    ("heading2", "Mark Items as Processed"),
    ("normal", "1. Add a second Apply to each action."),
    ("normal", "2. Use body('Get_items')?['value'] as the input again."),
    ("normal", "3. Inside the loop, add Update item."),
    ("normal", "4. Select the same SharePoint site and ScanSnapLog list."),
    ("normal", "5. Set ID to the current item ID."),
    ("normal", "6. Set Processed to Yes."),
    ("normal", "7. Keep any required fields mapped from the current item if SharePoint requires them."),
    ("heading2", "Test Flow 2"),
    ("normal", "1. Save the flow."),
    ("normal", "2. Run the flow manually the first time."),
    ("normal", "3. Check that the email arrives."),
    ("normal", "4. Click a file name in the email and confirm it opens the correct OneDrive file."),
    ("normal", "5. Confirm the processed items are now marked Yes in SharePoint."),
    ("heading1", "Troubleshooting"),
    ("normal", "If no rows appear in SharePoint, make sure the trigger is pointed at the correct OneDrive folder."),
    ("normal", "If the email sends but the links do not work, check the sharing scope used in Create share link for a file or folder."),
    ("normal", "If the digest repeats the same files every day, verify that the Update item action is setting Processed to Yes."),
    ("normal", "If the flow triggers on unwanted file types, tighten the file extension checks in the Condition expression."),
    ("heading1", "Outcome"),
    ("normal", "After setup, you will have a cloud-only process that logs new ScanSnap files from OneDrive, stores clickable file links, and sends a nightly summary email without using local Python scripts, PowerShell scripts, or hardcoded SMTP credentials."),
]


def make_paragraph(style: str, text: str) -> str:
    escaped = escape(text)
    if style == "title":
        return (
            "<w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr>"
            f"<w:r><w:t>{escaped}</w:t></w:r></w:p>"
        )
    if style == "heading1":
        return (
            "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr>"
            f"<w:r><w:t>{escaped}</w:t></w:r></w:p>"
        )
    if style == "heading2":
        return (
            "<w:p><w:pPr><w:pStyle w:val=\"Heading2\"/></w:pPr>"
            f"<w:r><w:t>{escaped}</w:t></w:r></w:p>"
        )
    if style == "code":
        lines = text.splitlines() or [text]
        runs = []
        for idx, line in enumerate(lines):
            runs.append(
                "<w:r><w:rPr><w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/>"
                "<w:sz w:val=\"20\"/></w:rPr>"
                f"<w:t xml:space=\"preserve\">{escape(line)}</w:t></w:r>"
            )
            if idx != len(lines) - 1:
                runs.append("<w:r><w:br/></w:r>")
        return "<w:p>" + "".join(runs) + "</w:p>"
    return f"<w:p><w:r><w:t>{escaped}</w:t></w:r></w:p>"


document_xml = (
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
    "<w:document xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" "
    "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" "
    "xmlns:o=\"urn:schemas-microsoft-com:office:office\" "
    "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
    "xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" "
    "xmlns:v=\"urn:schemas-microsoft-com:vml\" "
    "xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" "
    "xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" "
    "xmlns:w10=\"urn:schemas-microsoft-com:office:word\" "
    "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" "
    "xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" "
    "xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" "
    "xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" "
    "xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\" "
    "xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" "
    "mc:Ignorable=\"w14 wp14\">"
    "<w:body>"
    + "".join(make_paragraph(style, text) for style, text in paragraphs)
    + "<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" "
    "w:bottom=\"1440\" w:left=\"1440\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/>"
    "<w:cols w:space=\"708\"/><w:docGrid w:linePitch=\"360\"/></w:sectPr>"
    "</w:body></w:document>"
)

content_types_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"""

rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""

document_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"""

styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="24"/>
    </w:rPr>
  </w:style>
</w:styles>
"""

core_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>ScanSnap Power Automate Setup Guide</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-03-23T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-03-23T00:00:00Z</dcterms:modified>
</cp:coreProperties>
"""

app_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Office Word</Application>
</Properties>
"""


OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

with ZipFile(OUT_PATH, "w", ZIP_DEFLATED) as docx:
    docx.writestr("[Content_Types].xml", content_types_xml)
    docx.writestr("_rels/.rels", rels_xml)
    docx.writestr("word/document.xml", document_xml)
    docx.writestr("word/_rels/document.xml.rels", document_rels_xml)
    docx.writestr("word/styles.xml", styles_xml)
    docx.writestr("docProps/core.xml", core_xml)
    docx.writestr("docProps/app.xml", app_xml)

print(OUT_PATH)
