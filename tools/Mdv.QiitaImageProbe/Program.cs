using System.Text.Json;
using Mdv.Core;

// Comparison helper: exercise the production importer and archive reader,
// rather than substituting the reference browser's already downloaded bytes.
if (args.Length != 2) throw new ArgumentException("Usage: Mdv.QiitaImageProbe job.json result.json");
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var job = JsonSerializer.Deserialize<Job>(File.ReadAllText(args[0]), json)!;
using var importer = new QiitaImageImporter(userAgent: job.UserAgent);
var manifest = await importer.ImportAsync(job.Document, job.Article, job.Sources);
var images = manifest.Images.DistinctBy(i => i.Hash).ToDictionary(i => i.Hash, i =>
{
    var saved = QiitaImageArchive.Read(job.Document, i);
    return new { saved.ContentType, Base64 = Convert.ToBase64String(saved.Bytes) };
});
File.WriteAllText(args[1], JsonSerializer.Serialize(new { Manifest = manifest, Images = images }, json));
Console.WriteLine($"Imported and verified {manifest.Images.Length} Qiita images.");

internal sealed record Job(string Document, string Article, string[] Sources, string UserAgent);
