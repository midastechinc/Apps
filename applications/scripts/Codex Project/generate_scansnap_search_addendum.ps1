$outPath = "C:\Users\AliJaffar\Downloads\Codex Project\ScanSnap_Search_System_Addendum.docx"
$tempRoot = Join-Path $env:TEMP ("scansnap_search_" + [guid]::NewGuid().ToString("N"))

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
  <dc:title>ScanSnap Search System Addendum</dc:title>
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
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>ScanSnap Search System Addendum</w:t></w:r></w:p>
    <w:p><w:r><w:t>This addendum extends the main ScanSnap Power Automate guide with an auto-updating document search system. The search page is a HTML file that reads a JSON index generated from the ScanSnapLog SharePoint list.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p>
    <w:p><w:r><w:t>Keep ScanSnapLog as the master index. When documents are organized by the AI flow, the log stores the final file name, folder, path, and link. A second flow generates documents.json from ScanSnapLog, and a HTML page uses that JSON to provide instant search.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Recommended files in OneDrive: Scans/document-search.html and Scans/documents.json.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part 1: Update the SharePoint List</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Open the ScanSnapLog list.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Keep the existing columns Title, FileName, FilePath, FolderName, CreatedTime, FileLink, and Processed.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Add a Yes/No column named IsActive with default value Yes.</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. Optional: add ConfidenceScore and OriginalFileName for troubleshooting.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part 2: Adjust the AI Organize Flow</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. In the AI organize flow, after the file is moved and the share link is created, make sure Create item writes these values:</w:t></w:r></w:p>
    <w:p><w:r><w:t>Title = final file name</w:t></w:r></w:p>
    <w:p><w:r><w:t>FileName = final file name</w:t></w:r></w:p>
    <w:p><w:r><w:t>FilePath = final destination path</w:t></w:r></w:p>
    <w:p><w:r><w:t>FolderName = predicted category or final folder name</w:t></w:r></w:p>
    <w:p><w:r><w:t>CreatedTime = utcNow()</w:t></w:r></w:p>
    <w:p><w:r><w:t>FileLink = final web URL</w:t></w:r></w:p>
    <w:p><w:r><w:t>Processed = No</w:t></w:r></w:p>
    <w:p><w:r><w:t>IsActive = Yes</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part 3: Build the JSON Index Flow</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Create the Flow</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Create a scheduled cloud flow named ScanSnap - Rebuild Search Index.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Set it to run every 1 hour. You can shorten this later if needed.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Get Active Documents</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Add Get items for the ScanSnapLog list.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Set Filter Query to:</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">IsActive eq 1</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Select Only Search Fields</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Add Select.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. From = value from Get items.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. Map these fields:</w:t></w:r></w:p>
    <w:p><w:r><w:t>name = FileName</w:t></w:r></w:p>
    <w:p><w:r><w:t>folder = FolderName</w:t></w:r></w:p>
    <w:p><w:r><w:t>path = FilePath</w:t></w:r></w:p>
    <w:p><w:r><w:t>link = FileLink</w:t></w:r></w:p>
    <w:p><w:r><w:t>created = CreatedTime</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Convert to JSON Text</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Add Compose.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Use the output of Select as the Compose input.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. This output becomes the documents.json content.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Write documents.json</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. Create Scans/documents.json manually once in OneDrive if it does not exist.</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. Add Update file using path.</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. File path = /Scans/documents.json</w:t></w:r></w:p>
    <w:p><w:r><w:t>4. File content = output of Compose.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part 4: Create the HTML Search Page</w:t></w:r></w:p>
    <w:p><w:r><w:t>Create a file named document-search.html in the Scans folder. This file stays fixed and reads documents.json each time it is opened.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Use this HTML:</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;!doctype html&gt;</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;html lang="en"&gt;</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;head&gt;&lt;meta charset="utf-8"&gt;&lt;title&gt;ScanSnap Search&lt;/title&gt;</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;style&gt;body{font-family:Segoe UI,Arial,sans-serif;margin:24px}input,select{padding:10px;margin-right:8px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}a{text-decoration:none;color:#0f6cbd}&lt;/style&gt;&lt;/head&gt;</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;body&gt;</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;h1&gt;ScanSnap Document Search&lt;/h1&gt;</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;input id="q" placeholder="Search file name or folder"&gt;</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;select id="folder"&gt;&lt;option value=""&gt;All folders&lt;/option&gt;&lt;/select&gt;</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;table&gt;&lt;thead&gt;&lt;tr&gt;&lt;th&gt;File&lt;/th&gt;&lt;th&gt;Folder&lt;/th&gt;&lt;th&gt;Created&lt;/th&gt;&lt;/tr&gt;&lt;/thead&gt;&lt;tbody id="rows"&gt;&lt;/tbody&gt;&lt;/table&gt;</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;script&gt;</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">let docs=[];const q=document.getElementById('q');const folder=document.getElementById('folder');const rows=document.getElementById('rows');</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">function render(){const term=q.value.toLowerCase();const pick=folder.value;rows.innerHTML='';docs.filter(d=&gt;(!pick||d.folder===pick)&amp;&amp;(`${d.name} ${d.folder}`.toLowerCase().includes(term))).forEach(d=&gt;{const tr=document.createElement('tr');tr.innerHTML=`&lt;td&gt;&lt;a href="${d.link}" target="_blank"&gt;${d.name}&lt;/a&gt;&lt;/td&gt;&lt;td&gt;${d.folder}&lt;/td&gt;&lt;td&gt;${d.created}&lt;/td&gt;`;rows.appendChild(tr);});}</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">fetch('documents.json').then(r=&gt;r.json()).then(data=&gt;{docs=data;[...new Set(docs.map(d=&gt;d.folder).filter(Boolean))].sort().forEach(f=&gt;{const o=document.createElement('option');o.value=f;o.textContent=f;folder.appendChild(o);});render();});</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">q.addEventListener('input',render);folder.addEventListener('change',render);</w:t></w:r><w:r><w:br/></w:r><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">&lt;/script&gt;&lt;/body&gt;&lt;/html&gt;</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part 5: Keep the Index Accurate</w:t></w:r></w:p>
    <w:p><w:r><w:t>When a document is deleted or manually removed, update ScanSnapLog so IsActive becomes No. The easiest first version is to mark items inactive manually if you remove them outside the flow.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Later, you can add a dedicated delete flow that watches the organized folders and updates the matching SharePoint row.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part 6: Recommended Final Flow Set</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. ScanSnap - AI Organize Inbox</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. ScanSnap - Nightly Digest</w:t></w:r></w:p>
    <w:p><w:r><w:t>3. ScanSnap - Rebuild Search Index</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Outcome</w:t></w:r></w:p>
    <w:p><w:r><w:t>With this addendum in place, new scans are organized automatically, listed in SharePoint, emailed in a nightly summary, and searchable through an automatically refreshed HTML search page.</w:t></w:r></w:p>
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
