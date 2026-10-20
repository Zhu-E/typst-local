-- Pandoc filter for Typst Local's Word export (see server/docx.js).
--
-- * Typst's HTML export reserves <h1> for the document title, so `= Heading`
--   arrives as <h2>: shift levels back so it becomes Word's "Heading 1".
-- * The document's own outline was replaced by a marker paragraph before
--   conversion; turn it into a real Word table of contents field.
-- * The template already renders its title page, so drop pandoc's title block.

local MARKER = 'TYPSTLOCALTOC::'
local toc_break_before = os.getenv('TYPST_LOCAL_TOC_BREAK_BEFORE') == '1'
local toc_break_after = os.getenv('TYPST_LOCAL_TOC_BREAK_AFTER') == '1'

local PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

local function escape(s)
  return (s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local function toc_field(title)
  local heading = ''
  if title ~= '' then
    heading = '<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t xml:space="preserve">'
      .. escape(title) .. '</w:t></w:r></w:p>'
  end
  return '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>'
    .. heading
    .. '<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>'
    .. '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'
    .. '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    .. '<w:r><w:t>Right-click here and choose Update Field to show the table of contents.</w:t></w:r>'
    .. '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    .. '</w:sdtContent></w:sdt>'
end

function Header(el)
  if el.level == 1 then
    return pandoc.Div({ pandoc.Para(el.content) }, { ['custom-style'] = 'Title' })
  end
  el.level = el.level - 1
  return el
end

function Para(el)
  local text = pandoc.utils.stringify(el)
  if text:sub(1, #MARKER) ~= MARKER then
    return nil
  end
  local blocks = {}
  if toc_break_before then
    table.insert(blocks, pandoc.RawBlock('openxml', PAGE_BREAK))
  end
  table.insert(blocks, pandoc.RawBlock('openxml', toc_field(text:sub(#MARKER + 1))))
  if toc_break_after then
    table.insert(blocks, pandoc.RawBlock('openxml', PAGE_BREAK))
  end
  return blocks
end

-- Underlined text (Typst's underline, e.g. on links) arrives as a styled span.
function Span(el)
  local style = el.attributes['style'] or ''
  if style:find('text%-decoration:%s*underline') then
    return pandoc.Underline(el.content)
  end
end

function Meta(meta)
  meta.title = nil
  meta.subtitle = nil
  meta.author = nil
  meta.date = nil
  meta.abstract = nil
  return meta
end

-- Cells carry their background colour and vertical alignment as attributes
-- (data-tl-fill, data-tl-valign); pandoc can't express those, so leave marker
-- runs that server/docx.js turns into real Word cell properties. Tables carry
-- their column widths and padding (data-tl-table), and side-by-side layouts
-- (Typst grids) are marked as such (data-tl-layout), both in the first cell.
local function attr(el, name)
  return el.attributes['data-' .. name] or el.attributes[name]
end

local function prepend(cell, xml)
  local marker = pandoc.RawInline('openxml', xml)
  local first = cell.contents[1]
  if first and (first.t == 'Plain' or first.t == 'Para') then
    first.content:insert(1, marker)
  else
    cell.contents:insert(1, pandoc.Plain({ marker }))
  end
end

local function mark_cell(cell)
  local fill = attr(cell, 'tl-fill')
  local valign = attr(cell, 'tl-valign')
  local align = cell.attributes['align']
  if align == 'center' then
    cell.alignment = pandoc.AlignCenter
  elseif align == 'right' then
    cell.alignment = pandoc.AlignRight
  end
  if fill or valign then
    prepend(cell, '<w:r><w:t>TLCELL' .. (fill and fill:upper() or '') .. '|' .. (valign or '') .. '</w:t></w:r>')
  end
end

local function first_cell(tbl)
  local row = tbl.head.rows[1] or (tbl.bodies[1] and (tbl.bodies[1].head[1] or tbl.bodies[1].body[1]))
  return row and row.cells[1]
end

function Table(tbl)
  local cell = first_cell(tbl)
  local layout = attr(tbl, 'tl-layout')
  local props = attr(tbl, 'tl-table')
  local function rows(list)
    for _, row in ipairs(list) do
      for _, c in ipairs(row.cells) do mark_cell(c) end
    end
  end
  rows(tbl.head.rows)
  for _, body in ipairs(tbl.bodies) do
    rows(body.head)
    rows(body.body)
  end
  rows(tbl.foot.rows)
  if cell and layout then prepend(cell, '<w:r><w:t>TLLAYOUT' .. layout .. '</w:t></w:r>') end
  if cell and props then prepend(cell, '<w:r><w:t>TLTABLE' .. props .. '</w:t></w:r>') end
  return tbl
end
