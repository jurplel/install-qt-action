function Controller() {
    installer.autoRejectMessageBoxes();
    installer.setMessageBoxAutomaticAnswer("OverwriteTargetDirectory", QMessageBox.Yes);
    installer.installationFinished.connect(function() {
        gui.clickButton(buttons.NextButton);
    });
}

Controller.prototype.WelcomePageCallback = function() {
	console.log("Welcome")
    gui.clickButton(buttons.NextButton, 10000);
}

Controller.prototype.CredentialsPageCallback = function() {
    gui.clickButton(buttons.NextButton);
}

Controller.prototype.IntroductionPageCallback = function() {
    gui.clickButton(buttons.NextButton);
}

Controller.prototype.TargetDirectoryPageCallback = function()
{
	var path = installer.value("HomeDir", "C:") + "\\Qt";
    gui.currentPageWidget().TargetDirectoryLineEdit.setText(path);
    gui.clickButton(buttons.NextButton);
}

Controller.prototype.ComponentSelectionPageCallback = function() {
    function list_packages() {
        var components = installer.components();
        console.log("Available components: " + components.length);
        var packages = ["Packages: "];
        for (var i = 0 ; i < components.length ;i++) {
            packages.push(components[i].name);
        }
        console.log(packages.join(" "));
    }

    list_packages();

    var widget = gui.currentPageWidget();

    console.log(widget);

    widget.deselectAll();
    widget.selectComponent("qt.qt5.5125.win64_msvc2017_64");

    gui.clickButton(buttons.NextButton);
}

Controller.prototype.LicenseAgreementPageCallback = function() {
    gui.currentPageWidget().AcceptLicenseRadioButton.setChecked(true);
    gui.clickButton(buttons.NextButton);
}

Controller.prototype.StartMenuDirectoryPageCallback = function() {
    gui.clickButton(buttons.NextButton);
}

Controller.prototype.ReadyForInstallationPageCallback = function()
{
    gui.clickButton(buttons.NextButton);
}

Controller.prototype.FinishedPageCallback = function() {
    var checkBoxForm = gui.currentPageWidget().LaunchQtCreatorCheckBoxForm
    if (checkBoxForm && checkBoxForm.launchQtCreatorCheckBox) {
        checkBoxForm.launchQtCreatorCheckBox.checked = false;
    }
    gui.clickButton(buttons.FinishButton);
}