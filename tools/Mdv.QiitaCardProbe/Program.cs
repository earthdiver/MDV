using System.Text.Json;
using Mdv.Core;
if (args.Length != 2) throw new ArgumentException("Usage: Mdv.QiitaCardProbe job.json result.json");
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var job = JsonSerializer.Deserialize<Job>(File.ReadAllText(args[0]), json)!;
using var importer = new QiitaCardImporter(userAgent: job.UserAgent);
var manifest = await importer.ImportAsync(job.Document, job.Sources);
var images = manifest.Cards.Select(c => c.Image).OfType<QiitaCardImage>().DistinctBy(i => i.Hash).ToDictionary(i => i.Hash, i =>
{
    var saved = QiitaCardArchive.Read(job.Document, i);
    return new { saved.ContentType, Base64 = Convert.ToBase64String(saved.Bytes) };
});
File.WriteAllText(args[1], JsonSerializer.Serialize(new { Manifest = manifest, Images = images }, json));
Console.WriteLine($"Imported and verified {manifest.Cards.Length} Qiita cards.");
internal sealed record Job(string Document, string[] Sources, string UserAgent);
