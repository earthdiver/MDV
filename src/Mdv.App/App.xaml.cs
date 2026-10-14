using Mdv.Core;
using System.Windows;

namespace Mdv.App;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DispatcherUnhandledException += (_, args) =>
        {
            args.Handled = true;
            if (e.Args.Contains("--smoke-test")) NativeSmoke.Fail(e.Args, args.Exception);
            else { MessageBox.Show(args.Exception.Message, UiLanguage.Text("MDV — エラー", "MDV — Error"), MessageBoxButton.OK, MessageBoxImage.Error); Shutdown(1); }
        };
        try
        {
            var window = new MainWindow(e.Args);
            MainWindow = window;
            window.Show();
        }
        catch (Exception error)
        {
            if (e.Args.Contains("--smoke-test")) NativeSmoke.Fail(e.Args, error);
            else { MessageBox.Show(error.Message, UiLanguage.Text("MDVを起動できません", "Unable to start MDV"), MessageBoxButton.OK, MessageBoxImage.Error); Shutdown(1); }
        }
    }
}
