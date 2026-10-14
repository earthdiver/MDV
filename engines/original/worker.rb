# frozen_string_literal: true

# JSON Lines transport: stdout is reserved for protocol messages; diagnostics go
# to stderr. Each worker loads only the selected service's public implementation.
require "json"
require "digest"

# GitHub's repository viewer renders YAML metadata before the Markdown body.
# Keep this host feature out of public-default comparison renders.
def github_frontmatter_value(value, depth = 0)
  raise ArgumentError, "Front matter nesting is too deep" if depth > 20
  if value.is_a?(Hash)
    headers = value.keys.map { |key| "<th>#{CGI.escapeHTML(key.to_s)}</th>" }.join
    cells = value.values.map { |child| "<td>#{github_frontmatter_value(child, depth + 1)}</td>" }.join
    "<table><thead><tr>#{headers}</tr></thead><tbody><tr>#{cells}</tr></tbody></table>"
  else
    text = value.is_a?(String) ? value : JSON.generate(value)
    "<div dir=\"auto\">#{CGI.escapeHTML(text)}</div>"
  end
end

def github_frontmatter(markdown)
  match = markdown.match(/\A\uFEFF?---\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\z)/m)
  return ["", markdown] unless match
  require "yaml"
  require "cgi"
  source = match[1]
  begin
    values = YAML.safe_load(source, permitted_classes: [], permitted_symbols: [], aliases: false)
    return ["", markdown] unless values.is_a?(Hash)
    rows = values.map do |key, value|
      text = value.is_a?(String) ? value : JSON.generate(value)
      rendered = value.is_a?(Hash) ? github_frontmatter_value(value) : CGI.escapeHTML(text)
      "<tr><th>#{CGI.escapeHTML(key.to_s)}</th><td>#{rendered}</td></tr>"
    end.join
    html = "<table class=\"frontmatter\"><tbody>#{rows}</tbody></table>\n"
  rescue Psych::SyntaxError
    return ["", markdown]
  rescue Psych::Exception, ArgumentError
    html = "<pre>#{CGI.escapeHTML(source)}</pre>\n"
  end
  [html, markdown[match.end(0)..]]
end

STDIN.set_encoding(Encoding::UTF_8)
STDOUT.set_encoding(Encoding::UTF_8)
STDOUT.sync = true

mode = ARGV.fetch(0)
desktop = ARGV[1] == "--desktop"
case mode
when "github"
  require "github/markup"
  require "commonmarker"
  renderer = GitHub::Markup::Markdown.new
  context = {} # The public wrapper's defaults, NOT guessed github.com settings.
when "qiita"
  require "qiita-markdown"
  context = { hostname: "example.com", script: false, strict: false }
  if desktop
    # Keep public defaults in comparison runs; accept case variants in the app.
    aliases = Qiita::Markdown::Filters::DEFAULT_LANGUAGE_ALIASES.dup
    aliases.default_proc = lambda do |table, language|
      if language.is_a?(String)
        lower = language.downcase
        table.fetch(lower) { Rouge::Lexer.find(lower) ? lower : language }
      else
        language
      end
    end
    context[:language_aliases] = aliases
  end
  renderer = Qiita::Markdown::Processor.new(context)
else
  abort "Unknown engine: #{mode}"
end

metadata = {
  protocol: 1, mode: mode, host_profile: desktop ? "desktop" : "public-default", ruby: RUBY_DESCRIPTION, platform: RUBY_PLATFORM,
  profile: mode == "github" ? "github-markup-default" : "qiita-processor-default",
  context: context, service_status: "unverified",
  lock_sha256: Digest::SHA256.file("#{ENV.fetch('BUNDLE_GEMFILE')}.lock").hexdigest,
  gems: Gem.loaded_specs.sort.to_h.transform_values { |spec| spec.version.to_s },
  sources: Bundler.load.specs.select { |spec| spec.source.is_a?(Bundler::Source::Git) }
    .to_h { |spec| [spec.name, { uri: spec.source.uri, revision: spec.source.revision }] },
}
puts JSON.generate(type: "ready", metadata: metadata)

STDIN.each_line do |line|
  request = nil
  begin
    # The host enforces a byte limit before sending, too.
    raise ArgumentError, "Request exceeds 24 MiB" if line.bytesize > 24 * 1024 * 1024
    request = JSON.parse(line)
    raise ArgumentError, "Request must be an object" unless request.is_a?(Hash)
    raise ArgumentError, "Invalid request id" unless request["id"].is_a?(Integer)
    markdown = request.fetch("markdown")
    raise ArgumentError, "Markdown must be a string of at most 4 Mi characters" unless
      markdown.is_a?(String) && markdown.length <= 4 * 1024 * 1024
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    if mode == "github"
      # The public wrapper defaults omit raw HTML and service extensions. The
      # app explicitly requests them and ALWAYS sanitizes HTML before insertion.
      # This is an MDV profile, not an assertion about github.com's deployment.
      options = desktop ? { commonmarker_opts: [:UNSAFE, :FOOTNOTES],
        commonmarker_exts: [:tagfilter, :autolink, :table, :strikethrough, :tasklist, :alerts] } : {}
      frontmatter, body = desktop ? github_frontmatter(markdown) : ["", markdown]
      html = frontmatter + renderer.render("document.md", body, options: options)
      extracted = {}
    else
      result = renderer.call(markdown)
      html = result.fetch(:output).to_s
      extracted = result.reject { |key, _| key == :output }
    end
    elapsed = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000
    puts JSON.generate(id: request["id"], ok: true, html: html,
                       extracted: extracted, elapsed_ms: elapsed)
  rescue StandardError => error
    puts JSON.generate(id: request.is_a?(Hash) ? request["id"] : nil, ok: false,
                       error: { type: error.class.name, message: error.message })
  end
end
